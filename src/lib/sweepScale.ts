import { config } from "@/lib/config";

/**
 * Whether this instance runs a new project at trial size. Never in production:
 * a customer's first sweep is not something an env var left behind should be
 * able to shrink.
 */
export function smallSweep(): boolean {
  return process.env.NODE_ENV !== "production" && config().SWEEP_SCALE === "small";
}

/** What a trial-size project reads. About $0.02 of Reddit and scoring, against $0.20. */
export const SMALL_SWEEP = {
  /** Reddit searches walked, each in both orders, a page being about 100 posts. */
  queries: 4,
  /** Pages each walk reads, with no second pass. */
  pages: 1,
  /** Posts the sweep may find. */
  posts: 300,
  /** Google queries discovery may buy. */
  discoveryQueries: 3,
} as const;
