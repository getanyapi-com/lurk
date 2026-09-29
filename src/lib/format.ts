const MINUTE_MS = 60_000;
const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365;

/**
 * How old something is, in the short form the whole product uses: minutes, then
 * hours, then days, then years once a thing is older than a year.
 */
export function shortAge(date: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / MINUTE_MS));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < HOURS_PER_DAY) {
    return `${hours}h`;
  }
  const days = Math.round(hours / HOURS_PER_DAY);
  return days < DAYS_PER_YEAR ? `${days}d` : `${Math.floor(days / DAYS_PER_YEAR)}y`;
}

/** The same age as a phrase, for a sentence about when something happened. */
export function relativeAge(date: Date, now = new Date()): string {
  const age = shortAge(date, now);
  return age === "0m" ? "just now" : `${age} ago`;
}

/** How long until something happens, or "now" once its time has passed. */
export function relativeUntil(date: Date, now = new Date()): string {
  if (date.getTime() <= now.getTime()) {
    return "now";
  }
  return `in ${shortAge(now, date)}`;
}

/** A count as a short mono figure: 950, 1.2k, 18k, 2.4M. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/u, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
}
