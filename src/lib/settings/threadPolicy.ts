import type { ThreadPolicy, ThreadPolicySettings } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The one place a thread setting becomes something the scan can ask. `now` is
 * the instant the window is measured from, so a caller judging a whole scan's
 * worth of posts measures every one of them against the same moment.
 */
export function threadPolicyFor(settings: ThreadPolicySettings, now = new Date()): ThreadPolicy {
  return {
    minReplies: settings.minReplies,
    threadsPerScan: settings.threadsPerScan,
    readSeoReplies: settings.readSeoReplies,
    readOldThreadsOnce: settings.readOldThreadsOnce,
    freshSince: (at = now) => new Date(at.getTime() - settings.replyWindowDays * DAY_MS),
  };
}
