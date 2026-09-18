import { writeProgress } from "@/jobs/enqueue";
import { clientForUser } from "@/lib/anyapi";
import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchSearch } from "@/lib/reddit/skus";
import { asRawPost, upsertPosts, type StoredPost } from "@/lib/reddit/store";
import { constraintQueries } from "@/lib/discovery/rank";
import { TRIAGE_BATCH_SIZE } from "./constants";
import { retrieved, type PlanRow } from "./coverage";
import { loadEvaluations, writeEvaluations } from "./evaluations";
import { writeLeads, type LeadRow } from "./leads";
import { loadScanProject, type ScanProject } from "./project";
import { SMALL_SWEEP, smallSweep, spread } from "@/lib/sweepScale";
import { evaluationsFor, fetchAvatars, postItem, routed, toLead, unjudged } from "./run";
import type { Judgement } from "./judgement";
import { judgeItems, readOrder, triageTitles } from "./score";
import type { StoredJudgement } from "./evaluations";
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
 *
 * What it spends is bounded three ways, each measured 2026-09-18 on a sweep of
 * 22 walks that read every page: 4,229 posts, 137 leads, $0.46. Read this way
 * the same sweep keeps 130 of the 137 for $0.11:
 *
 *   depth    walks read FIRST_PASS_PAGES, and only one that found a lead reads
 *            on, to DEPTH_PAGES. Pages one and two held 71% of the qualified
 *            leads in 18% of the posts; pages nine and later held 3 in 1,074.
 *   triage   a title under ASKING_FLOOR is not scored. Scoring a post costs
 *            six times what triaging it does, and 95% of scored posts were
 *            rejected.
 *   budget   POST_BUDGET posts, whatever the plan's size, so one project's
 *            first sweep costs about $0.20 at most.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Lead authors a sweep looks up, best leads first. $0.00038 each through `reddit.avatar`, so 2¢. */
const FACES = 50;

/** Pages in a row carrying nothing new to their walk before the walk ends. */
const STALE_PAGES = 3;

/**
 * Pages each walk reads in the first pass, before any walk reads more. A page
 * takes about two seconds and a walk reads its pages one after another, so
 * the first pass is over in about as many seconds as this times two, whatever
 * the deepest listing holds; measured 2026-09-18, one relevance walk needed
 * 59 pages and the sweep waited 53 seconds on it. The walks then pick up from
 * their cursors and read the rest of the year.
 */
const FIRST_PASS_PAGES = 2;

/** Pages a walk reads in all, when its first pass found a lead. */
const DEPTH_PAGES = 6;

/**
 * Posts one sweep may find. A found post costs about $0.000076 all in: its
 * share of a search page, its title's triage, and the scoring of the 41% that
 * pass the floor. 2,500 of them is $0.19.
 */
const POST_BUDGET = 2500;

/**
 * The triage `asking` a title needs before its post is scored. Measured on the
 * 3,914 posts the sweep above scored (.context/probe-triage.ts): 0.10 keeps
 * 1,616 of them and every one of the 137 leads; 0.20 keeps 1,012 and loses 4.
 */
const ASKING_FLOOR = 0.1;

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
 * It also stops when the listing stops moving: three pages in a row that carry
 * nothing this walk has not already seen. Measured 2026-09-18 on the cheapest
 * source, a relevance walk ran 183 pages for 302 posts, every page after the
 * eleventh the same posts under a new cursor, and the walk before the stop
 * was the whole cost of the sweep.
 *
 * A page that fails ends this walk and nothing else. Measured 2026-09-14 on
 * lurk.so: 13 of 380 paged searches in two days came back "all providers
 * failed", a transient upstream error, and each one threw away a whole sweep
 * of dozens of walks and made its person wait a scan interval for the retry.
 * The pages before it are kept; the true answer is whether it was cut short.
 */
type Walk = {
  query: Query;
  sort: (typeof SORTS)[number];
  /** Where to continue from; unset before the first page. */
  cursor?: string;
  /** Posts this walk has already been handed, to notice a listing that stops moving. */
  walked: Set<string>;
  stale: number;
};

/** How a walk ended: at the end of its listing, at its page cap or the sweep's post budget, or on a failed page. */
type WalkEnd = "done" | "paused" | "cutShort";

async function walk(
  ctx: FetchContext,
  state: Walk,
  maxPages: number,
  postBudget: number,
  found: Map<string, StoredPost>,
  sources: Map<string, CandidateSource[]>,
  landed: (posts: StoredPost[]) => void,
): Promise<WalkEnd> {
  const { query, sort, walked } = state;
  let { cursor, stale } = state;
  for (let pages = 0; ; pages += 1) {
    if (pages >= maxPages || found.size >= postBudget) {
      state.cursor = cursor;
      state.stale = stale;
      return "paused";
    }
    let result: Awaited<ReturnType<typeof fetchSearch>>;
    try {
      result = await fetchSearch(ctx, query.text, {
        timeframe: "year",
        sort,
        ...(cursor ? { cursor } : {}),
      });
    } catch {
      return "cutShort";
    }
    const fresh: StoredPost[] = [];
    let moved = false;
    for (const post of result.value.posts) {
      if (!walked.has(post.id)) {
        walked.add(post.id);
        moved = true;
      }
      if (!found.has(post.id)) {
        // Every walk checks the budget before its page and all of them are in
        // flight at once, so without this the pages already asked for land on
        // top of it: the 2026-09-18 sweep found 4,164 posts on a budget of 2,500.
        if (found.size >= postBudget) {
          continue;
        }
        fresh.push(post);
      }
      found.set(post.id, post);
      const held = sources.get(post.id) ?? [];
      held.push({ kind: "search", key: query.text, rows: query.rows });
      sources.set(post.id, held);
    }
    landed(fresh);
    stale = moved ? 0 : stale + 1;
    const next = result.value.nextCursor ?? undefined;
    if (!next || next === cursor || stale >= STALE_PAGES) {
      return "done";
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

/**
 * Judges posts as the pages carrying them land, while the other walks are
 * still searching. Posts queue until a triage call's worth has arrived, or
 * the search is over, and each chunk is triaged, ordered, judged and
 * committed batch by batch before the next chunk starts. The 2026-09-17 run
 * searched for 51 seconds before judging its first title; the person watching
 * their feed sees leads in the first few seconds of a sweep instead.
 */
class Judge {
  private pending: StoredPost[] = [];
  private seen = new Set<string>();
  private running: Promise<void> | null = null;
  private draining = false;
  readonly judged: Judgement[] = [];
  readonly leads: LeadRow[] = [];
  readonly candidates: StoredPost[] = [];

  constructor(
    private readonly project: ScanProject,
    private readonly stored: Map<string, StoredJudgement>,
    private readonly sources: Map<string, CandidateSource[]>,
    private readonly report: () => Promise<void>,
  ) {}

  /** Posts a page just carried; only the ones with no verdict are queued. */
  offer(posts: StoredPost[]): void {
    for (const post of unjudged(this.project, this.stored, posts)) {
      if (!this.seen.has(post.id)) {
        this.seen.add(post.id);
        this.pending.push(post);
      }
    }
    this.pump();
  }

  /** Judges whatever is queued, and resolves once every chunk has landed. */
  async settle(): Promise<void> {
    this.draining = true;
    this.pump();
    while (this.running) {
      await this.running;
    }
    this.draining = false;
  }

  private pump(): void {
    if (this.running) {
      return;
    }
    if (this.pending.length === 0 || (!this.draining && this.pending.length < TRIAGE_BATCH_SIZE)) {
      return;
    }
    const chunk = this.pending;
    this.pending = [];
    this.running = this.judge(chunk).finally(() => {
      this.running = null;
      this.pump();
    });
  }

  private async judge(chunk: StoredPost[]): Promise<void> {
    // Retention can delete an unreferenced post while this sweep still holds
    // it, so re-persist the chunk before pointing a source or a lead at it.
    await upsertPosts(chunk.map(asRawPost));
    await recordSources(
      this.project.id,
      chunk.map((post) => ({ postId: post.id, sources: this.sources.get(post.id) ?? [] })),
    );
    this.candidates.push(...chunk);
    const now = Date.now();
    const triage = await triageTitles(
      this.project.id,
      this.project.product,
      chunk.map((post) => ({
        id: post.id,
        title: post.title,
        subreddit: post.subreddit,
        author: post.author,
        score: post.score,
        ageHours: (now - post.createdAt.getTime()) / HOUR_MS,
      })),
    );
    const byId = new Map(chunk.map((post) => [post.id, post]));
    const facts = new Map(
      chunk.map((post) => [
        post.id,
        { ageHours: (now - post.createdAt.getTime()) / HOUR_MS, upvotes: post.score },
      ]),
    );
    const ordered = readOrder(
      triage.filter((item) => item.asking >= ASKING_FLOOR),
      facts,
    )
      .map((id) => byId.get(id))
      .filter((post): post is StoredPost => post !== undefined);

    // Every batch of verdicts is committed the moment it lands, so the feed
    // fills while the sweep is still running. A batch whose commit fails is
    // not lost either: whatever is still uncommitted is written from the list
    // judgeItems returns.
    const committed = new Set<string>();
    const commit = async (batch: Judgement[]): Promise<void> => {
      await writeEvaluations(evaluationsFor(this.project, chunk, batch));
      const written = routed(batch.map((judgement) => ({ judgement }))).map((item) =>
        toLead(this.project, item.judgement, item.judgement.id, null, item.kind),
      );
      await writeLeads(written);
      this.leads.push(...written);
      for (const judgement of batch) {
        committed.add(judgement.id);
      }
      this.judged.push(...batch);
      await this.report();
    };
    const judgements = await judgeItems(
      this.project.id,
      this.project.product,
      ordered.map(postItem),
      new Map(),
      commit,
    );
    const uncommitted = judgements.filter((judgement) => !committed.has(judgement.id));
    if (uncommitted.length > 0) {
      await commit(uncommitted);
    }
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

  // A trial-size sweep is the same sweep over less: see src/lib/sweepScale.ts.
  const small = smallSweep();
  const queries = small ? spread(queriesOf(project), SMALL_SWEEP.queries) : queriesOf(project);
  const postBudget = small ? SMALL_SWEEP.posts : POST_BUDGET;
  const firstPassPages = small ? SMALL_SWEEP.pages : FIRST_PASS_PAGES;
  const depthPages = small ? SMALL_SWEEP.pages : DEPTH_PAGES;
  const found = new Map<string, StoredPost>();
  const sourcesByPost = new Map<string, CandidateSource[]>();
  const plan: Walk[] = queries.flatMap((query) =>
    SORTS.map((sort) => ({ query, sort, walked: new Set<string>(), stale: 0 })),
  );
  let walks = 0;
  let cutShort = 0;
  let pass: "first" | "rest" | "scoring" = "first";
  const report = (): Promise<void> =>
    progress(
      jobId,
      pass === "first"
        ? `First pass over a year of Reddit · ${plan.length} searches · ${found.size} posts found · ${judge.judged.length} scored · ${judge.leads.length} leads`
        : pass === "rest"
          ? `Reading further where the leads are · ${walks} of ${plan.length} searches done · ${found.size} posts found · ${judge.judged.length} scored · ${judge.leads.length} leads`
          : `Scoring ${judge.candidates.length} posts · ${judge.judged.length} scored · ${judge.leads.length} leads`,
    );
  const judge: Judge = new Judge(project, await loadEvaluations(projectId), sourcesByPost, report);

  // Every walk is independent of every other and nearly all waiting on Reddit,
  // so all of them start at once and the shared pace in src/lib/reddit/pace.ts
  // decides how many calls are actually in flight. Each page hands its new
  // posts to the judge as it lands. The first pass reads a few pages of every
  // walk, so the feed has leads in seconds; the second reads further into the
  // walks that found one.
  await report();
  const run = async (item: Walk, maxPages: number): Promise<WalkEnd> => {
    const end = await walk(ctx, item, maxPages, postBudget, found, sourcesByPost, (posts) =>
      judge.offer(posts),
    );
    if (end === "cutShort") {
      cutShort += 1;
    }
    await report();
    return end;
  };
  const ends = await Promise.all(plan.map((item) => run(item, firstPassPages)));
  await judge.settle();
  const leadPosts = new Set(judge.leads.map((lead) => lead.postId));
  const deeper = plan.filter(
    (item, index) => depthPages > firstPassPages && ends[index] === "paused" && [...item.walked].some((id) => leadPosts.has(id)),
  );
  walks = plan.length - deeper.length;
  pass = "rest";
  await report();
  await Promise.all(
    deeper.map(async (item) => {
      await run(item, depthPages - firstPassPages);
      walks += 1;
    }),
  );
  pass = "scoring";
  await report();
  await judge.settle();

  // Faces for the top of the feed only. A full sweep writes hundreds of leads:
  // looked up for all 448 of them on 2026-09-18, through `reddit.profile` as
  // it then was, they were $0.88 of a $1.27 sweep, and they shared
  // Reddit's pace with the searches, which tripled how long the sweep took.
  // The rest keep their initials until a scan or a refresh reaches them.
  const faces = [...judge.leads]
    .sort((a, b) => b.score - a.score)
    .slice(0, FACES)
    .map((lead) => found.get(lead.postId)?.author ?? "");
  await fetchAvatars(ctx, faces);

  // A post several walks found gained sources after its chunk was judged, so
  // record every source once more; the ones already written are ignored.
  await recordSources(
    projectId,
    [...sourcesByPost.entries()].map(([postId, sources]) => ({ postId, sources })),
  );
  await creditSources(
    sourcesByPost,
    judge.candidates.map((post) => post.id),
    judge.leads.map((lead) => lead.postId),
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
  return {
    walks,
    found: found.size,
    judged: judge.judged.length,
    leads: judge.leads.length,
    cutShort,
  };
}
