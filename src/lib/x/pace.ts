import { config } from "@/lib/config";

/**
 * A process-wide limit on paid twitter.* calls in flight. Reddit's pace
 * (src/lib/reddit/pace.ts) is tuned to the vendors behind reddit.* and is left
 * alone; nothing about X's lanes has been measured yet, so this is a plain
 * semaphore. If the pilot sees 429s, lower X_CALLS_IN_FLIGHT before building
 * anything adaptive.
 */

let inFlight = 0;
const waiting: Array<() => void> = [];

function limit(): number {
  return config().X_CALLS_IN_FLIGHT;
}

/**
 * Runs `fn` once a slot is free. A finishing call hands its slot straight to
 * the next waiter rather than freeing it, so a caller arriving in between can
 * never slip past the limit.
 */
export async function paced<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= limit()) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    inFlight += 1;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      inFlight -= 1;
    }
  }
}

/** For tests: how many calls hold a slot and how many wait. */
export function xPaceSnapshot(): { inFlight: number; waiting: number } {
  return { inFlight, waiting: waiting.length };
}
