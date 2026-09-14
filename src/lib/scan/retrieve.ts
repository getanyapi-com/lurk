import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchPost, fetchSearch, fetchSubredditPosts } from "@/lib/reddit/skus";
import type { StoredPost } from "@/lib/reddit/store";
import type { RedditThread } from "@/lib/seo/links";
import type { TierLimits } from "@/lib/tiers";
import { serpCallsToday } from "@/lib/usage";
import { retrievalBudgets } from "./constants";
import {
  byWorth,
  coverageTimeframe,
  explorationPick,
  googleFeedQuery,
  listingStop,
  needsWideSweep,
  retrieved,
  scopedQuery,
  type PlanRow,
} from "./coverage";
import type { ScanProject } from "./project";
import { fetchFeedThreads } from "./serp";
import { lastWideSweeps, recordSources, type CandidateSource } from "./sources";

/**
 * One scan's retrieval: the plan's searches, its scoped searches, its listing
 * pilots and its Google feed, each covering the window from its own watermark,
 * merged by post with every source that found it. A fetch that fails covers no
 * window and is reported as a gap, so a window is never silently skipped. The
 * windows a fetch did cover are handed back for the caller to mark, because a
 * watermark may only move once the posts under it have been judged and stored.
 */

const HOUR_MS = 60 * 60 * 1000;

export type Candidate = { post: StoredPost; sources: CandidateSource[] };

export type Retrieval = {
  candidates: Candidate[];
  /** Windows this scan could not finish covering, in the user's words. */
  gaps: string[];
  /** Posts dropped as older than the feed window. They stay as evidence. */
  outsideWindow: number;
  /** reddit.post calls already spent, which the shortlist read may not spend twice. */
  hydrated: number;
  /**
   * The windows this scan covered, waiting for their watermarks to move. The
   * caller marks them with markCovered once these candidates' judgements are
   * written, so a death between the fetch and the verdict re-covers the window.
   */
  covered: { row: PlanRow; at: Date }[];
};

type Loop = {
  ctx: FetchContext;
  now: Date;
  windowMs: number;
  overlapMs: number;
  pages: number;
  found: Map<string, Candidate>;
  gaps: string[];
  covered: { row: PlanRow; at: Date }[];
  outsideWindow: number;
};

function keep(loop: Loop, posts: StoredPost[], source: CandidateSource): void {
  for (const post of posts) {
    if (loop.now.getTime() - post.createdAt.getTime() > loop.windowMs) {
      loop.outsideWindow += 1;
      continue;
    }
    const held = loop.found.get(post.id);
    if (held) {
      held.sources.push(source);
      continue;
    }
    loop.found.set(post.id, { post, sources: [source] });
  }
}

function timeframeFor(loop: Loop, row: PlanRow): "day" | "week" | "month" {
  return coverageTimeframe({
    lastCoveredAt: row.lastCoveredAt,
    now: loop.now,
    windowMs: loop.windowMs,
    overlapMs: loop.overlapMs,
  });
}

/** One plain search of a query's own window, or its weekly reconciliation. */
async function runSearch(loop: Loop, row: PlanRow, wide: boolean): Promise<void> {
  const chosen = timeframeFor(loop, row);
  const timeframe = wide && chosen === "day" ? "week" : chosen;
  try {
    const result = await fetchSearch(loop.ctx, row.key, { timeframe });
    keep(loop, result.value.posts, { kind: "search", key: row.key, rows: [row] });
    loop.covered.push({ row, at: loop.now });
  } catch {
    loop.gaps.push(`The search for "${row.key}" failed, so its ${timeframe} is not covered.`);
  }
}

/** One community's own window, asked as a search rather than as a listing. */
async function runScoped(loop: Loop, community: PlanRow, query: PlanRow): Promise<void> {
  const timeframe = timeframeFor(loop, community);
  const text = scopedQuery(community.key, query.key);
  try {
    const result = await fetchSearch(loop.ctx, text, { timeframe });
    keep(loop, result.value.posts, { kind: "scoped", key: text, rows: [community, query] });
  } catch {
    loop.gaps.push(`The search of r/${community.key} for "${query.key}" failed.`);
  }
}

/**
 * One community's listing, newest first, page by page until a post older than
 * the watermark appears, the listing runs out, or the page budget is spent.
 * Only the first two mean the window is covered; the third leaves a gap and the
 * watermark where it was, so the next scan starts from the same place.
 */
async function runListing(loop: Loop, row: PlanRow): Promise<void> {
  const watermark = row.lastCoveredAt ?? new Date(loop.now.getTime() - loop.windowMs);
  let cursor: string | undefined;
  for (let page = 0; page < loop.pages; page += 1) {
    let value: { posts: StoredPost[]; nextCursor: string | null };
    try {
      const result = await fetchSubredditPosts(loop.ctx, row.key, cursor ? { cursor } : {});
      value = result.value;
    } catch {
      loop.gaps.push(`Reading r/${row.key} failed on page ${page + 1}.`);
      return;
    }
    keep(loop, value.posts, { kind: "listing", key: row.key, rows: [row] });
    const stop = listingStop({
      posts: value.posts,
      nextCursor: value.nextCursor,
      page,
      pages: loop.pages,
      watermark,
    });
    if (stop === "covered" || stop === "exhausted") {
      loop.covered.push({ row, at: loop.now });
      return;
    }
    if (stop === "budget") {
      loop.gaps.push(
        `r/${row.key} had more new posts than ${loop.pages} pages could reach, so its window is only partly covered.`,
      );
      return;
    }
    cursor = value.nextCursor ?? undefined;
  }
}

/**
 * The Google feed for one query. A result is a link and a title, with no age
 * at all, so every thread we do not already hold is opened before the window
 * filter can judge it. A thread older than the window stays discovery evidence
 * and never becomes a lead. A Google fetch moves no watermark: it covers a
 * different index of the same week, and only a Reddit fetch can say the
 * project's own window is covered.
 */
async function runSerp(loop: Loop, row: PlanRow, budget: number): Promise<number> {
  const query = googleFeedQuery(row.key);
  let threads: RedditThread[];
  try {
    const result = await fetchFeedThreads(loop.ctx, query);
    threads = result.value;
  } catch {
    loop.gaps.push(`The Google search for "${row.key}" failed.`);
    return 0;
  }
  let spent = 0;
  for (const thread of threads) {
    if (loop.found.has(thread.postId)) {
      loop.found.get(thread.postId)?.sources.push({ kind: "serp", key: query, rows: [row] });
      continue;
    }
    if (spent >= budget) {
      loop.gaps.push("The Google feed found more threads than this scan could open.");
      return spent;
    }
    spent += 1;
    try {
      const post = (await fetchPost(loop.ctx, thread.canonicalUrl, loop.ctx.maxAgeMs)).value[0];
      if (post) {
        keep(loop, [post], { kind: "serp", key: query, rows: [row] });
      }
    } catch {
      loop.gaps.push(`Opening ${thread.canonicalUrl} failed.`);
    }
  }
  return spent;
}

/** The rows this scan searches: the best active ones, plus the explorer. */
function searchSlots(project: ScanProject, budget: number, explorer: PlanRow | null): PlanRow[] {
  const reserved = explorer?.table === "keyword" ? 1 : 0;
  const active = byWorth(retrieved(project.queries)).slice(0, Math.max(budget - reserved, 0));
  return reserved && explorer ? [...active, explorer] : active;
}

/** The communities this scan polls: the best active ones, plus the explorer. */
function listingSlots(project: ScanProject, budget: number, explorer: PlanRow | null): PlanRow[] {
  const reserved = explorer?.table === "community" ? 1 : 0;
  const active = byWorth(retrieved(project.communities)).slice(0, Math.max(budget - reserved, 0));
  return reserved && explorer ? [...active, explorer] : active;
}

export type RetrieveInput = {
  project: ScanProject;
  ctx: FetchContext;
  limits: TierLimits | null;
  windowMs: number;
  scanIntervalHours: number;
  /** reddit.post calls this scan may spend in total; null means no cap. */
  hydration: number | null;
  now?: Date;
};

/**
 * Runs the whole plan for one scan and returns what it found, once, with the
 * provenance rows already written and the covered windows left for the caller
 * to mark.
 */
export async function retrieve(input: RetrieveInput): Promise<Retrieval> {
  const { project, ctx, limits, windowMs } = input;
  const now = input.now ?? new Date();
  const budgets = retrievalBudgets(limits);
  const loop: Loop = {
    ctx,
    now,
    windowMs,
    overlapMs: input.scanIntervalHours * HOUR_MS,
    pages: budgets.pages,
    found: new Map(),
    gaps: [],
    covered: [],
    outsideWindow: 0,
  };
  const explorer = explorationPick(project.queries, project.communities);
  const queries = searchSlots(project, budgets.searches, explorer);
  const wide = await lastWideSweeps(queries.map((row) => row.key));

  for (const row of queries) {
    await runSearch(loop, row, needsWideSweep(wide.get(row.key.toLowerCase()) ?? null, now));
  }
  const communities = byWorth(retrieved(project.communities)).slice(0, budgets.scoped);
  const best = byWorth(retrieved(project.queries))[0] ?? queries[0];
  if (best) {
    for (const community of communities) {
      await runScoped(loop, community, best);
    }
  }
  for (const row of listingSlots(project, budgets.listings, explorer)) {
    await runListing(loop, row);
  }

  let hydrated = 0;
  const allowance = Math.max(budgets.serpPerDay - (await serpCallsToday(project.id)), 0);
  const serpRows = byWorth(retrieved(project.queries)).slice(0, allowance);
  for (const row of serpRows) {
    const left = input.hydration === null ? Number.MAX_SAFE_INTEGER : input.hydration - hydrated;
    hydrated += await runSerp(loop, row, Math.max(left, 0));
  }

  const candidates = [...loop.found.values()];
  await recordSources(
    project.id,
    candidates.map((candidate) => ({ postId: candidate.post.id, sources: candidate.sources })),
  );
  return {
    candidates,
    gaps: loop.gaps,
    outsideWindow: loop.outsideWindow,
    hydrated,
    covered: loop.covered,
  };
}
