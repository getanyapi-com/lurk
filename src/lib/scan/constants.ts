import { TIERS, type TierLimits } from "@/lib/tiers";

/**
 * The user's optional extra floor on the feed, set on the Product page. The
 * non-compensatory gates in gates.ts decide what qualifies; this only hides
 * qualified leads a user considers too weak. The default is the bottom of the
 * qualified band (a lead just at the lead model's threshold folds to 50), so
 * out of the box it admits every qualified lead.
 */
export const DEFAULT_SCORE_THRESHOLD = 50;

/**
 * How many items one scoring call judges at a time. One: the other posts in a
 * request are distractors to the one being asked about, and on 2,362 labelled
 * posts on 2026-09-22 the same questions told good from bad at 0.843 AUC one
 * post at a time against 0.828 ten at a time (.context/exp). At Jev's price the
 * product facts sent again with every post cost under a cent a thousand.
 */
export const SCORE_BATCH_SIZE = 1;

/**
 * How many posts one shared reading call reads at a time. The reading carries
 * no product, so ten a request costs the three product-agnostic questions
 * nothing in accuracy and a tenth of the requests.
 */
export const READING_BATCH_SIZE = 10;

/**
 * How many model calls one job has in flight at once. Separate from the Reddit
 * budget (lib/inFlight.ts CALL_CONCURRENCY) because it is a different provider with a different limit, and sharing
 * one number made every model phase run at Reddit's.
 *
 * Measured against OpenRouter on 2026-09-10 with the real triage prompt and
 * real titles, 70 to a batch (.context/probe-concurrency.ts):
 *
 *   concurrency 10   30 batches   279.0s   median call 82.2s   p95 129.1s
 *   concurrency 30   30 batches   136.5s   median call 83.1s   p95 133.2s
 *   concurrency 60   60 batches   147.8s   median call 81.3s   p95 114.8s
 *
 * No failure at any arm and no per-call slowdown at 60, so 60 is the largest
 * the evidence covers rather than a guess. It is also more than the 62 triage
 * and 59 scoring batches the largest sweep so far produced, which is what turns
 * six sequential waves into one.
 */
export const MODEL_CONCURRENCY = 60;

/**
 * How many titles one triage call reads at a time. The saved runs in
 * .context/reddit-leads-proof/scorer-pass.md and scorer-pass-2.md triaged 70,
 * 77 and 78 titles in a single call and each came back complete, so 70 is the
 * largest batch measurement supports rather than a guess. Sending every title
 * of a large project in one call is what left a scan of 188 titles stalled on
 * 2026-09-06.
 */
export const TRIAGE_BATCH_SIZE = 70;

/** What one scan may buy of each kind. A self-hosted instance has no tier of
 * its own, so it retrieves like a connected one and caps nothing. */
export function retrievalBudgets(limits: TierLimits | null): {
  searches: number;
  scoped: number;
  listings: number;
  serpPerDay: number;
  pages: number;
  /**
   * How many posts one scan may open in full, whatever it opens them for, or
   * null for no cap. Both hydrating a Google result and reading a shortlisted
   * candidate buy the same reddit.post call, so they spend one budget: the
   * tier's `hydrationPerScan`.
   */
  hydration: number | null;
} {
  const source = limits ?? TIERS.connected;
  return {
    searches: source.searchesPerScan,
    scoped: source.scopedSearchesPerScan,
    listings: source.listingPilotsPerScan,
    serpPerDay: source.serpQueriesPerDay,
    pages: source.searchPagesPerQuery,
    hydration: limits ? limits.hydrationPerScan : null,
  };
}

/**
 * How alive and how answerable a thread is, 0-4, computed here from facts we
 * hold rather than asked of a model that cannot see a clock. Two halves:
 *
 *   freshness   under 24h: 2   under 72h: 1   older: 0
 *   reply room  no replies: 2  under 10: 1    10 or more: 0
 *
 * The 24 and 72 hour steps are the decay hypothesis the external review
 * proposed (astra-roast-2026-09-06.md, "ranking heuristic"), not a measured
 * constant. The reply-room half says a crowded thread is a worse place to
 * answer, never that it is solved: only the model's needState can say that.
 */
export function engagementScore(ageHours: number, numComments: number | null): number {
  const freshness = ageHours <= 24 ? 2 : ageHours <= 72 ? 1 : 0;
  const replies = numComments ?? 0;
  const room = replies === 0 ? 2 : replies < 10 ? 1 : 0;
  return freshness + room;
}

