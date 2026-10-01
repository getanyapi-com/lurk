/**
 * How many calls one job has in flight at once when it names no other limit.
 * Measured on Reddit, opening posts and walking searches alike: the measured
 * run read 540 posts ten at a time without a failure, so ten is what the
 * evidence covers.
 */
export const CALL_CONCURRENCY = 10;

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
