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

/** Whether an error leads with the SQL of a statement that failed, as drizzle writes one. */
export function isFailedQuery(message: string): boolean {
  return message.startsWith("Failed query:");
}

/**
 * The first sentence of a stored failure, which is written for whoever debugs
 * it, for the status line that follows "Last scan stopped:". A failed statement
 * leads with its SQL, which means nothing to the person reading the tab, so
 * that one is said in words instead.
 */
export function errorSentence(error: string): string {
  if (isFailedQuery(error)) {
    return "the database could not finish it. It is safe to try again.";
  }
  const line = error.split("\n")[0].trim();
  return line.endsWith(".") ? line : `${line}.`;
}

/**
 * A count as a short mono figure: 950, 1.2k, 18k, 2.4M. `upper` writes the
 * thousands as X does under a post, 1.2K.
 */
export function compactCount(value: number, { upper = false }: { upper?: boolean } = {}): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/u, "")}${upper ? "K" : "k"}`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
}

/** Nothing a detail pane shows is estimated, so a fact the platform never gave reads as a dash. */
export const MISSING = "-";

/** A count written out in full, 12,345, or `missing` when there is none. */
export function fullCount(value: number | null | undefined, missing = MISSING): string {
  return value == null ? missing : value.toLocaleString("en-US");
}
