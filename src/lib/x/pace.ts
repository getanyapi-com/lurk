import { config } from "@/lib/config";

/**
 * A limit on work in flight, read afresh at every call. A finishing call hands
 * its slot straight to the next waiter rather than freeing it, so a caller
 * arriving in between can never slip past the limit.
 */
export function semaphore(limit: () => number): <T>(fn: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= limit()) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running += 1;
    }
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        running -= 1;
      }
    }
  };
}

/**
 * A process-wide limit on paid twitter.* calls in flight. Reddit's pace
 * (src/lib/reddit/pace.ts) is tuned to the vendors behind reddit.* and is left
 * alone; nothing about X's lanes has been measured yet, so this is a plain
 * semaphore. If the pilot sees 429s, lower X_CALLS_IN_FLIGHT before building
 * anything adaptive.
 */
export const paced = semaphore(() => config().X_CALLS_IN_FLIGHT);
