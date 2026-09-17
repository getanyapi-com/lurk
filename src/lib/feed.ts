/** Feed vocabulary shared by the server queries and the client filter pills. */

import type { LeadKind } from "@/lib/scan/gates";

export type { LeadKind };

/**
 * `resolved` is written by the scan, not by the user: the person said in the
 * thread that their need is met, so the lead leaves the feed without pretending
 * the user judged it.
 */
export type LeadStatus = "new" | "hidden" | "not_fit" | "resolved";

/**
 * The date pills over the feed. Days, plus `all`: the first scan reaches back
 * a year, so the recent window that opens the feed is not everything there is.
 */
export const FEED_WINDOWS = [1, 7, 30, "all"] as const;

export type FeedWindow = (typeof FEED_WINDOWS)[number];

export type FeedFilter = {
  status: LeadStatus;
  days: FeedWindow;
  kind?: LeadKind;
  subreddit?: string;
  stage?: string;
  /** One Insights theme's id, narrowing the feed to the leads that theme holds. */
  theme?: string;
};

export type FeedFacets = { subreddits: string[]; stages: string[] };

/** The filters the leads page reads out of its own URL. */
export type FeedParams = {
  project?: string;
  status?: string;
  days?: string;
  subreddit?: string;
  stage?: string;
  theme?: string;
  lead?: string;
};

const STATUSES: LeadStatus[] = ["new", "hidden", "not_fit", "resolved"];

/**
 * The filter those pills mean, read the same way by the page and by the action
 * that fetches the next page of it. A value that is not one of ours is the
 * default, so nothing a client sends can widen what a query asks for.
 */
export function feedFilter(params: FeedParams): FeedFilter {
  return {
    status: STATUSES.find((one) => one === params.status) ?? "new",
    days: FEED_WINDOWS.find((one) => String(one) === params.days) ?? 30,
    subreddit: params.subreddit || undefined,
    stage: params.stage || undefined,
    theme: params.theme || undefined,
  };
}

/**
 * How many leads one read of the feed brings back.
 *
 * The list column is one screen tall and its rows measure 66px, so a screen
 * holds thirteen of them at 900px and twenty-one on a 1440px display. A page of
 * twenty-four fills the tallest of those with a row to spare, which is what
 * makes the next page something you scroll for rather than something the page
 * fetches the moment it opens. Before this, a project with a year of backfill
 * behind it read and drew every lead it had before anything appeared at all.
 */
export const FEED_PAGE_SIZE = 24;

/** One slice of the feed, in the feed's own order. */
export type FeedPage = { limit: number; offset: number };

/** One line in the list column, which is all it takes to draw a row. */
export type FeedRow = {
  /** The entry id the URL carries, not the lead's own id. */
  id: string;
  title: string;
  author: string | null;
  avatarUrl: string | null;
  subreddit: string;
  subredditIconUrl: string | null;
  createdAt: Date;
  fit: number | null;
  intent: number | null;
};

/** One face in the people strip: who posted, when, and how it scored. */
export type LeadFace = {
  id: string;
  at: Date;
  score: number;
  author: string | null;
  avatarUrl: string | null;
  subreddit: string;
};

export type LeadCost = { sku: string; costUsd: number; requestId: string | null };

/** One candidate the scan could not settle, as the leads page shows it. */
export type ReviewItem = {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  author: string | null;
  avatarUrl: string | null;
  authorKarma: number | null;
  authorCreatedAt: Date | null;
  subredditIconUrl: string | null;
  numComments: number | null;
  points: number | null;
  isComment: boolean;
  reason: string;
  reasonCodes: string[];
  fit: number | null;
  intent: number | null;
  needState: string;
  createdAt: Date;
  judgedAt: Date;
};
