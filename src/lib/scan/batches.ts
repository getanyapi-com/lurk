import { JevRequestTooLargeError } from "@/lib/jev";
import { MODEL_CONCURRENCY, inFlight } from "./constants";

/**
 * Several candidates per Jev request, because the product facts and the API
 * overhead are paid once per request: measured 2026-09-17, ten posts per
 * request cost 1,851 input tokens a post against 2,329 alone, and thirty cost
 * the same as ten (.context/typesafe/probe3.py). What the model reads in one
 * request is a token ceiling, not a count, so a request it refuses as too
 * large is split in half and asked again, down to one candidate.
 */
export async function askInBatches<T, R>(
  items: T[],
  size: number,
  ask: (batch: T[]) => Promise<R[]>,
  unanswered: (batch: T[]) => R[],
): Promise<R[]> {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
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
      // A batch the model never answered is unanswered, never rejected: one
      // dropped connection lost a whole sweep's triage on 2026-09-10.
      return unanswered(batch);
    }
  };
  const done = await inFlight(batches, askSplitting, MODEL_CONCURRENCY);
  return done.flat();
}
