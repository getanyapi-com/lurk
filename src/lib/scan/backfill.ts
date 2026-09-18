import { writeProgress } from "@/jobs/enqueue";
import { clientForUser } from "@/lib/anyapi";
import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchSearch } from "@/lib/reddit/skus";
import { asRawPost, upsertPosts, type StoredPost } from "@/lib/reddit/store";
import { constraintQueries } from "@/lib/discovery/rank";
import { CALL_CONCURRENCY } from "./constants";
import { retrieved, type PlanRow } from "./coverage";
import { loadEvaluations, writeEvaluations } from "./evaluations";
import { writeLeads, type LeadRow } from "./leads";
import { loadScanProject, type ScanProject } from "./project";
import { evaluationsFor, postItem, routed, toLead, unjudged } from "./run";
import type { Judgement } from "./judgement";
import { judgeItems, readOrder, triageTitles } from "./score";
import { creditSources, markCovered, recordSources, type CandidateSource } from "./sources";

/**
 * The one-time sweep a new project starts with. A scan polls the last thirty
 * days; this asks Reddit's own search for a year of the problem's language, in
 * both orders it can be sorted, and keeps everything it finds however old it
 * is, because a person who asked eleven months ago is still the person a
 * founder wants to answer. There is no reading gate and no `reddit.post` call
 * here: search now carries the body, and the reading costs more than judging
 * the same post twice would. It never writes `seo_opportunities` either, which
 * is what keeps the Reddit SEO tab a Google-only list.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Both orders one query can be read in; see fetchSearch on why both are bought. */
const SORTS = ["relevance", "new"] as const;

export type BackfillOutcome = {
  /** Query and sort pairs walked. */
  walks: number;
  /** Distinct posts the sweep found. */
  found: number;
  /** Posts this project had no verdict on, so this sweep judged them. */
  judged: number;
  /** Leads written, of either kind. */
  leads: number;
  /** Walks a failed page ended before Reddit ran out of pages. */
  cutShort: number;
};

/** One query, as it is asked and what plan rows it credits. */
type Query = { text: string; rows: PlanRow[] };

/**
 * The whole of one query in one order, page after page. The walk stops when
 * Reddit stops handing out a cursor, or hands back the one just followed. It
 * does not stop on a page that carried nothing new: measured 2026-09-10, the
 * relevance sort returns sparse pages in the middle of a listing (2, 6, 6, 1,
 * 0, then six full pages), so treating the first of them as the end truncated
 * `(hotel OR hotels) AND "under 21"` to 16 posts where the listing holds 150.
 * There is no page cap: a year of one phrasing is what the sweep is for.
 *
 * A page that fails ends this walk and nothing else. Measured 2026-09-14 on
 * lurk.so: 13 of 380 paged searches in two days came back "all providers
 * failed", a transient upstream error, and each one threw away a whole sweep
 * of dozens of walks and made its person wait a scan interval for the retry.
 * The pages before it are kept; the true answer is whether it was cut short.
 */
async function walk(
  ctx: FetchContext,
  query: Query,
  sort: (typeof SORTS)[number],
  found: Map<string, StoredPost>,
  sources: Map<string, CandidateSource[]>,
): Promise<{ cutShort: boolean }> {
  let cursor: string | undefined;
  for (;;) {
    let result: Awaited<ReturnType<typeof fetchSearch>>;
    try {
      result = await fetchSearch(ctx, query.text, {
        timeframe: "year",
        sort,
        ...(cursor ? { cursor } : {}),
      });
    } catch {
      return { cutShort: true };
    }
    for (const post of result.value.posts) {
      found.set(post.id, post);
      const held = sources.get(post.id) ?? [];
      held.push({ kind: "search", key: query.text, rows: query.rows });
      sources.set(post.id, held);
    }
    const next = result.value.nextCursor ?? undefined;
    if (!next || next === cursor) {
      return { cutShort: false };
    }
    cursor = next;
  }
}

/**
 * Everything this project knows how to ask: each keyword row split into one
 * search per constraint, so no single constraint's posts are lost behind a
 * bounded listing (see `constraintQueries`), and each phrasing of the problem
 * as plain words. Measured 2026-09-10: a quoted phrasing returned nothing,
 * because a buyer rarely types the profile's exact sentence.
 */
function queriesOf(project: ScanProject): Query[] {
  const rows = retrieved(project.queries);
  const byText = new Map<string, Query>();
  const add = (text: string, row: PlanRow | null) => {
    const held = byText.get(text) ?? { text, rows: [] as PlanRow[] };
    if (row) {
      held.rows.push(row);
    }
    byText.set(text, held);
  };
  // Two compiled keywords that differ only in a constraint the other also has
  // split into the same searches, and a query is walked once however many plan
  // rows it covers. Each row it covers is still credited.
  for (const row of rows) {
    for (const text of constraintQueries(row.key)) {
      add(text, row);
    }
  }
  for (const phrasing of project.phrasings) {
    add(phrasing, null);
  }
  return [...byText.values()];
}

async function progress(jobId: string | undefined, text: string): Promise<void> {
  if (jobId) {
    await writeProgress(jobId, text);
  }
}

/** One backfill: sweep a year, judge what has no verdict, write the leads. */
export async function runBackfill(projectId: string, jobId?: string): Promise<BackfillOutcome> {
  const project = await loadScanProject(projectId);
  if (!project) {
    throw new Error("This project no longer exists");
  }
  const funded = await clientForUser(project.userId);
  // A backfill reuses nothing. A retry exists because the first attempt was
  // truncated or died, and a cached page from that attempt would hand the retry
  // the same truncated listing: the 2026-09-10 run served all 532 of its
  // searches from the cache of earlier failures and so never reached Reddit.
  const ctx: FetchContext = { projectId, funded, maxAgeMs: 0 };

  const queries = queriesOf(project);
  const found = new Map<string, StoredPost>();
  const sourcesByPost = new Map<string, CandidateSource[]>();
  // Every walk is independent of every other, and a walk is nearly all waiting
  // on Reddit. Run them the same number at a time the reading pass does, or a
  // first sweep makes its user wait an hour for a feed.
  const plan = queries.flatMap((query) => SORTS.map((sort) => ({ query, sort })));
  let walks = 0;
  let cutShort = 0;
  const next = async (): Promise<void> => {
    for (;;) {
      const item = plan[walks];
      if (!item) {
        return;
      }
      walks += 1;
      await progress(
        jobId,
        `Searching a year of "${item.query.text}" · ${walks} of ${plan.length} searches · ${found.size} posts found`,
      );
      const outcome = await walk(ctx, item.query, item.sort, found, sourcesByPost);
      if (outcome.cutShort) {
        cutShort += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CALL_CONCURRENCY, plan.length) }, () => next()),
  );

  // Retention can delete an unreferenced post while this sweep still holds it,
  // so re-persist everything found before pointing a source or a lead at it.
  await upsertPosts([...found.values()].map(asRawPost));
  await recordSources(
    projectId,
    [...sourcesByPost.entries()].map(([postId, sources]) => ({ postId, sources })),
  );
  const stored = await loadEvaluations(projectId);
  const candidates = await unjudged(project, stored, [...found.values()]);

  await progress(jobId, `Reading ${candidates.length} titles`);
  const triage = await triageTitles(
    projectId,
    project.product,
    candidates.map((post) => ({
      id: post.id,
      title: post.title,
      subreddit: post.subreddit,
      author: post.author,
      score: post.score,
      ageHours: (Date.now() - post.createdAt.getTime()) / HOUR_MS,
    })),
  );
  const byId = new Map(candidates.map((post) => [post.id, post]));
  const facts = new Map(
    candidates.map((post) => [
      post.id,
      { ageHours: (Date.now() - post.createdAt.getTime()) / HOUR_MS, upvotes: post.score },
    ]),
  );
  const ordered = readOrder(triage, facts)
    .map((id) => byId.get(id))
    .filter((post): post is StoredPost => post !== undefined);

  // Every batch of verdicts is committed the moment it lands, so the feed fills
  // while the sweep is still running instead of staying empty for the whole of
  // it: the 2026-09-10 re-run judged for seven minutes after nine of triage and
  // showed nothing until the last of them. A batch whose commit fails is not
  // lost either, because the sweep writes whatever is still uncommitted at the
  // end from the list judgeItems returns.
  await progress(jobId, `Scoring ${ordered.length} posts`);
  const leads: LeadRow[] = [];
  const committed = new Set<string>();
  const commit = async (batch: Judgement[]): Promise<void> => {
    await writeEvaluations(await evaluationsFor(project, candidates, batch));
    const written = routed(batch.map((judgement) => ({ judgement }))).map((item) =>
      toLead(project, item.judgement, item.judgement.id, null, item.kind),
    );
    await writeLeads(written);
    leads.push(...written);
    for (const judgement of batch) {
      committed.add(judgement.id);
    }
    await progress(jobId, `Scored ${committed.size} of ${ordered.length} posts`);
  };
  const judgements = await judgeItems(
    projectId,
    project.product,
    ordered.map(postItem),
    new Map(),
    commit,
  );
  const uncommitted = judgements.filter((judgement) => !committed.has(judgement.id));
  if (uncommitted.length > 0) {
    await commit(uncommitted);
  }
  await creditSources(
    sourcesByPost,
    ordered.map((post) => post.id),
    leads.map((lead) => lead.postId),
  );
  const at = new Date();
  for (const query of queries) {
    for (const row of query.rows) {
      await markCovered(row, at);
    }
  }

  await progress(
    jobId,
    cutShort === 0
      ? "Finished"
      : `Finished; ${cutShort} of ${walks} searches stopped early on a Reddit error`,
  );
  return { walks, found: found.size, judged: judgements.length, leads: leads.length, cutShort };
}
