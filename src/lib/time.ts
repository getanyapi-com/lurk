/**
 * Lengths of time and the two moments every window is counted from, with
 * nothing server-side in it, so a query, a job and a component all mean the
 * same day by "a day".
 */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** The moment `days` whole days before `now`: where a window of that many days starts. */
export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Midnight UTC at the start of `now`'s day, which is when every daily budget starts over. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
