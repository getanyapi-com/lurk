import { googleQuery } from "@/lib/seo/fetch";

/**
 * How one scan decides what to cover and in what order. Every decision here is
 * a pure function of the plan rows and the clock, so the retrieval loop only
 * has to spend the calls these functions choose.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** How a candidate was found: a plain search, a scoped one, a listing, Google. */
export type SourceKind = "search" | "scoped" | "listing" | "serp";

/** Which plan table a row lives in, so its counters can be found again. */
export type PlanTable = "keyword" | "community";

/** One row of the retrieval plan: a query to run, or a community to poll. */
export type PlanRow = {
  id: string;
  table: PlanTable;
  key: string;
  source: string;
  state: string;
  lastCoveredAt: Date | null;
  /**
   * How much relevant evidence Google returned for this row, the model's own
   * verdicts weighted: a relevant thread counts one and a plausible one a half.
   * It is what discovery measured, never what a model guessed about a query it
   * had not seen answered.
   */
  evidence: number;
};

/** The states that are retrieved every scan. Everything else is a candidate. */
export function retrieved(rows: PlanRow[]): PlanRow[] {
  return rows.filter((row) => row.state === "active" || row.state === "pinned");
}

/** The rows discovery proposed but has not promoted; exploration's only pool. */
export function unproven(rows: PlanRow[]): PlanRow[] {
  return rows.filter((row) => row.state === "candidate");
}

/**
 * Oldest watermark first, and a row never covered before that. A row that has
 * gone longest without coverage is the one a rotating slot owes a turn to.
 */
export function byStaleness(rows: PlanRow[]): PlanRow[] {
  return [...rows].sort((a, b) => {
    const left = a.lastCoveredAt?.getTime() ?? 0;
    const right = b.lastCoveredAt?.getTime() ?? 0;
    return left - right;
  });
}

/**
 * The order a scan spends its searches in. A scan buys fewer searches than a
 * plan holds rows, and staleness alone gave every row the same claim on them:
 * on lurk.so on 2026-09-14 `instagram api`, whose Google results the model
 * called relevant six times, took its turn behind `ahrefs api`, which it called
 * relevant three times. A row nothing has covered yet goes first, so every new
 * row is tried once whatever its evidence; after that the evidence decides, and
 * staleness breaks the tie so two equal rows still rotate.
 */
export function byWorth(rows: PlanRow[]): PlanRow[] {
  return [...byStaleness(rows)].sort((a, b) => {
    const untried = Number(b.lastCoveredAt === null) - Number(a.lastCoveredAt === null);
    return untried || b.evidence - a.evidence;
  });
}

/**
 * The one unproven row this scan gives a slot to: the stalest candidate query
 * or community. One slot in the eight searches and two listings a free scan
 * buys is the exploration share the plan asks for, spent by rotation rather
 * than by a share recomputed every scan.
 */
export function explorationPick(queries: PlanRow[], communities: PlanRow[]): PlanRow | null {
  return byStaleness([...unproven(queries), ...unproven(communities)])[0] ?? null;
}

/**
 * How far back this row must be asked to look. A row with no watermark, or one
 * whose watermark has fallen out of the feed window, is backfilled with a month;
 * otherwise the smallest window that reaches the watermark is used.
 *
 * The overlap is one scan interval, because the watermark is written when the
 * fetch happens and posts made during the scan itself would otherwise fall in
 * the seam between two windows.
 */
export function coverageTimeframe(input: {
  lastCoveredAt: Date | null;
  now: Date;
  windowMs: number;
  overlapMs: number;
}): "day" | "week" | "month" {
  const { lastCoveredAt, now, windowMs, overlapMs } = input;
  if (!lastCoveredAt) {
    return "month";
  }
  const gap = now.getTime() - lastCoveredAt.getTime() + overlapMs;
  if (gap > windowMs || gap > WEEK_MS) {
    return "month";
  }
  return gap <= DAY_MS ? "day" : "week";
}

/**
 * Whether this query is owed its weekly reconciliation: a week-wide or wider
 * search catches what a run of day-wide searches missed while it was covering
 * only the newest posts, so one is run whenever the last is older than a week.
 */
export function needsWideSweep(lastWideAt: Date | null, now: Date): boolean {
  return !lastWideAt || now.getTime() - lastWideAt.getTime() >= WEEK_MS;
}

/** A search aimed at one community, in the Boolean form Reddit search takes. */
export function scopedQuery(community: string, query: string): string {
  return `subreddit:${community} AND (${query})`;
}

/**
 * What a Google feed query says. The plan's Reddit queries are Boolean and
 * Google is not, so the operators and the community scope come out and what is
 * left is asked as the one Google question this app has.
 */
export function googleFeedQuery(query: string): string {
  const plain = query
    .replace(/\bsubreddit:\S+/gi, " ")
    .replace(/\b(AND|OR|NOT)\b/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return googleQuery(plain);
}

/** Why a listing walk stopped, or that it has not. */
export type WalkStop = "covered" | "exhausted" | "budget" | "continue";

/**
 * Whether a listing walk may stop after this page. It has covered the window
 * once a post older than the watermark appears, since the listing is newest
 * first and everything below is already accounted for. A listing with nothing
 * left to hand back is covered too. Only running out of pages with the walk
 * still above the watermark leaves a gap.
 */
export function listingStop(input: {
  posts: { createdAt: Date }[];
  nextCursor: string | null;
  page: number;
  pages: number;
  watermark: Date;
}): WalkStop {
  const { posts, nextCursor, page, pages, watermark } = input;
  if (posts.some((post) => post.createdAt.getTime() <= watermark.getTime())) {
    return "covered";
  }
  if (!nextCursor || posts.length === 0) {
    return "exhausted";
  }
  return page + 1 >= pages ? "budget" : "continue";
}
