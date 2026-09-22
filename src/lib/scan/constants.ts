import { TIERS, type TierLimits } from "@/lib/tiers";

/**
 * The user's optional extra floor on the feed, set on the Product page. The
 * non-compensatory gates in gates.ts decide what qualifies; this only hides
 * qualified leads a user considers too weak. The default is the bottom of the
 * qualified band (fit 3, intent 2, engagement 0 folds to 50), so out of the box
 * it admits every qualified lead.
 */
export const DEFAULT_SCORE_THRESHOLD = 50;

/** How many items one scoring call judges at a time. */
export const SCORE_BATCH_SIZE = 10;

/**
 * How many Reddit calls one job has in flight at once, whether it is opening
 * posts or walking a search. The measured run read 540 posts ten at a time
 * without a failure, so ten is what the evidence covers.
 */
export const CALL_CONCURRENCY = 10;

/**
 * How many model calls one job has in flight at once. Separate from the Reddit
 * budget because it is a different provider with a different limit, and sharing
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

/** Runs `work` over `items`, `limit` at a time, in the input order. */
export async function inFlight<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  limit: number = CALL_CONCURRENCY,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      if (index >= items.length) {
        return;
      }
      next += 1;
      out[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * How many titles one triage call reads at a time. The saved runs in
 * .context/reddit-leads-proof/scorer-pass.md and scorer-pass-2.md triaged 70,
 * 77 and 78 titles in a single call and each came back complete, so 70 is the
 * largest batch measurement supports rather than a guess. Sending every title
 * of a large project in one call is what left a scan of 188 titles stalled on
 * 2026-09-06.
 */
export const TRIAGE_BATCH_SIZE = 70;

/**
 * How many posts one scan may open in full, whatever it opens them for. Both
 * hydrating a Google result and reading a shortlisted candidate buy the same
 * reddit.post call, so they spend one budget: the tier's `hydrationPerScan`,
 * which replaces the old postReadCap because it caps exactly the same calls.
 */
export function hydrationCap(limits: TierLimits | null): number | null {
  return limits ? limits.hydrationPerScan : null;
}

/** What one scan may buy of each kind. A self-hosted instance has no tier of
 * its own, so it retrieves like a connected one and caps nothing. */
export function retrievalBudgets(limits: TierLimits | null): {
  searches: number;
  scoped: number;
  listings: number;
  serpPerDay: number;
  pages: number;
} {
  const source = limits ?? TIERS.connected;
  return {
    searches: source.searchesPerScan,
    scoped: source.scopedSearchesPerScan,
    listings: source.listingPilotsPerScan,
    serpPerDay: source.serpQueriesPerDay,
    pages: source.searchPagesPerQuery,
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

/**
 * The feed's sort order, 0-100. Only leads the gates qualified reach the feed,
 * so this decides order among leads that already passed, never admission:
 *
 *   quality = 0.6 * match + 0.2 * intent / 4 + 0.2 * engagement / 4
 *   score   = 50 + 50 * (quality - 0.4) / 0.6, held to 0-100
 *
 * match is how well the product suits the person (derive.ts), and carries
 * three times the weight of intent or of the 0-4 engagement, because it is
 * what told good leads from bad on the posts labelled 2026-09-20; the fit and
 * intent sort it replaced was barely better than chance on 2026-09-22. A
 * qualified lead has every match answer at 0.5 or more and intent 2 or more,
 * so its quality is at least 0.4: the qualified band starts at 50, and the
 * maximum is 100. A missing match or intent counts as 0.
 */
export function foldScore(match: number | null, intent: number | null, engagement: number): number {
  const quality = 0.6 * (match ?? 0) + (0.2 * (intent ?? 0)) / 4 + (0.2 * engagement) / 4;
  const score = Math.round(50 + (50 * (quality - 0.4)) / 0.6);
  return Math.min(100, Math.max(0, score));
}
