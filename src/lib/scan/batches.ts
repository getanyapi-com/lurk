import { JevRequestTooLargeError } from "@/lib/jev";
import { LlmCapReachedError } from "@/lib/llm";
import { MODEL_CONCURRENCY, inFlight } from "./constants";

/**
 * How much state one Jev request carries, in tokens. Jev refuses a request
 * whose state is over about 32k tokens and does not count the questions:
 * measured 2026-09-19 (.context/probe-limit.mts), 32,000 words of state were
 * answered and 33,000 refused, and 600 questions on a 25,000-word state were
 * answered. The candidates get 24k and the product facts and anything else
 * shared by the request keep the rest.
 */
export const STATE_TOKEN_BUDGET = 24_000;

/**
 * What a piece of state costs, counted high: a token per two characters of its
 * JSON. Measured on Jev 2026-09-19 (.context/probe-ratio.mts), plain prose ran
 * 3.8 characters a token, post-shaped state 2.9 and title-shaped state 2.3,
 * the keys and punctuation being what costs. An over-count only makes a batch
 * smaller; an under-count is what gets a request refused.
 */
export function stateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 2);
}

/**
 * Several candidates per Jev request, because the product facts and the API
 * overhead are paid once per request: measured 2026-09-17, ten posts per
 * request cost 1,851 input tokens a post against 2,329 alone, and thirty cost
 * the same as ten (.context/typesafe/probe3.py). What the model reads in one
 * request is a token ceiling, not a count, so a batch closes at `size`
 * candidates or at STATE_TOKEN_BUDGET, whichever comes first, by what `weigh`
 * says each candidate adds to the state. A request refused as too large
 * anyway is split in half and asked again, down to one candidate.
 */
export async function askInBatches<T, R>(
  items: T[],
  size: number,
  ask: (batch: T[]) => Promise<R[]>,
  unanswered: (batch: T[]) => R[],
  weigh: (item: T) => number,
): Promise<R[]> {
  const batches = pack(items, size, weigh);
  const askSplitting = async (batch: T[]): Promise<R[]> => {
    try {
      return await ask(batch);
    } catch (error) {
      if (error instanceof JevRequestTooLargeError && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        const [left, right] = await Promise.all([
          askSplitting(batch.slice(0, half)),
          askSplitting(batch.slice(half)),
        ]);
        return [...left, ...right];
      }
      // The day's model budget being spent is not a dropped call: every batch
      // after it would go unanswered too, and the job would end "Finished"
      // having judged nothing (a 2026-09-18 run did). The job fails with the
      // reason instead, and is queued again at its cadence.
      if (error instanceof LlmCapReachedError) {
        throw error;
      }
      // A batch the model never answered is unanswered, never rejected: one
      // dropped connection lost a whole sweep's triage on 2026-09-10.
      return unanswered(batch);
    }
  };
  const done = await inFlight(batches, askSplitting, MODEL_CONCURRENCY);
  return done.flat();
}

/**
 * The items in order, cut into batches of at most `size` that stay inside
 * STATE_TOKEN_BUDGET. A single item over the budget goes alone, and the split
 * above is what answers for it.
 */
export function pack<T>(items: T[], size: number, weigh: (item: T) => number): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let tokens = 0;
  for (const item of items) {
    const weight = weigh(item);
    if (batch.length > 0 && (batch.length >= size || tokens + weight > STATE_TOKEN_BUDGET)) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(item);
    tokens += weight;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}
