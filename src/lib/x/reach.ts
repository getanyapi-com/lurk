import { REPLY_WINDOW_HOURS } from "./constants";

/**
 * How much a reply on a post would be seen, from what X said the post drew
 * and how old it is. A founder replies where buyers are reading: on 2026-09-27
 * one founder's replies on posts under 1k views got about 50 views, and on
 * posts over 5k a median of about 230 when made within five hours and under
 * 140 after seven (.context/x-plugs). Views are the post's own count when X
 * gave one, else a guess from its likes, carried forward at the rate the post
 * drew them when lurk saw it, since a post found an hour in shows an hour's
 * views. This only ranks; the tab shows X's own count.
 */

const HOUR_MS = 3_600_000;
/** Views per like, for a post X gave likes but no views for: the median across the founder's 26 targets was about 100. */
const VIEWS_PER_LIKE = 100;

export type ReachInput = {
  likeCount: number | null;
  viewCount: number | null;
  createdAt: Date;
  /** When X gave these counts. A post seen an hour after it went up has only an hour's views. */
  fetchedAt?: Date | null;
};

/** How far a post's early count is carried forward at the rate it drew views then: up to a day, and at most eightfold. */
const PROJECT_HOURS = 24;
const MAX_GROWTH = 8;

function views(post: ReachInput, now: Date): number {
  const counted = post.viewCount !== null && post.viewCount > 0 ? post.viewCount : (post.likeCount ?? 0) * VIEWS_PER_LIKE;
  if (!post.fetchedAt) return counted;
  const seenAt = Math.max(0.5, (post.fetchedAt.getTime() - post.createdAt.getTime()) / HOUR_MS);
  const ageNow = Math.min(PROJECT_HOURS, Math.max(0, (now.getTime() - post.createdAt.getTime()) / HOUR_MS));
  return counted * Math.min(MAX_GROWTH, Math.max(1, ageNow / seenAt));
}

/** How much of the reply window is left: whole inside it, then fading over the next two days. */
export function freshness(createdAt: Date, now: Date): number {
  const hours = Math.max(0, (now.getTime() - createdAt.getTime()) / HOUR_MS);
  if (hours <= REPLY_WINDOW_HOURS) return 1;
  if (hours <= 12) return 0.7;
  if (hours <= 24) return 0.45;
  if (hours <= 48) return 0.25;
  return 0.1;
}

/** Whether a reply now still lands while the post is being read. */
export function replyWindowOpen(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= REPLY_WINDOW_HOURS * HOUR_MS;
}

/**
 * Reach and freshness as one number, 0-100: views on a log scale (100 views is
 * 40, 10k is 80, 100k or more is 100) times what is left of the reply window.
 */
export function reachScore(post: ReachInput, now: Date): number {
  const scale = Math.min(1, Math.log10(1 + views(post, now)) / 5);
  return Math.round(100 * scale * freshness(post.createdAt, now));
}
