import { shortAge } from "@/lib/format";

import type { StreamEntry } from "@/components/leads/stream";
import type { ReviewItem } from "@/lib/feed";

/** What the detail pane is reading: a lead, or a candidate the scan held. */
export type Selection =
  | { kind: "lead"; entry: StreamEntry }
  | { kind: "held"; item: ReviewItem };

/**
 * A held candidate's id in the URL. Leads and held items share one `lead` slot,
 * so an evaluation id is prefixed and can never collide with a lead's.
 */
export function heldEntryId(item: ReviewItem): string {
  return `held-${item.id}`;
}

/**
 * The row the URL names, when the list on screen is holding it. The feed is
 * read a page at a time, so a lead can be asked for that this page does not
 * have; the caller reads that one from the database rather than falling back.
 */
export function requestedEntry(
  entries: StreamEntry[],
  held: ReviewItem[],
  requestedId?: string,
): Selection | null {
  if (!requestedId) {
    return null;
  }
  const entry = entries.find((one) => one.id === requestedId);
  if (entry) {
    return { kind: "lead", entry };
  }
  const item = held.find((one) => heldEntryId(one) === requestedId);
  return item ? { kind: "held", item } : null;
}

/**
 * What the workspace opens on: the row the URL asked for, or the best lead, or
 * the first held candidate when there are no leads at all. A `lead` left over
 * from a wider filter simply misses, so changing a pill never blanks the pane.
 */
export function selectEntry(
  entries: StreamEntry[],
  held: ReviewItem[],
  requestedId?: string,
): Selection | null {
  const requested = requestedEntry(entries, held, requestedId);
  if (requested) {
    return requested;
  }
  if (entries[0]) {
    return { kind: "lead", entry: entries[0] };
  }
  return held[0] ? { kind: "held", item: held[0] } : null;
}

/**
 * The same filters with one row selected, so opening a lead keeps the feed it
 * was found in and the back button returns to it.
 */
export function entryHref(
  params: Record<string, string | undefined>,
  entryId: string,
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name !== "lead" && value) {
      query.set(name, value);
    }
  }
  query.set("lead", entryId);
  return `?${query.toString()}`;
}

/** How long an account has been open, or a dash when Reddit did not say. */
export function accountAge(createdAt: Date | null): string {
  return createdAt ? `${shortAge(createdAt)} old` : "-";
}
