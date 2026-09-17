import { scoreBand, type ScoredThread } from "./score";

/**
 * How the Reddit SEO tab can be read, and in what order.
 *
 * Both vocabularies live here, away from the database module, because the
 * filter pills are drawn in the browser and a pill should not drag a Postgres
 * client into the bundle to learn what its own options are called.
 */

/**
 * The two shapes the tab offers. They read the same rows, in the same order,
 * and differ only in how much of one thread is on screen at once: the table
 * compares ninety of them, the split view reads one.
 */
export const SEO_VIEWS = [
  {
    id: "table",
    label: "Table",
    sentence: "One row per thread, every column comparable, sorted by the column you click.",
  },
  {
    id: "split",
    label: "List and thread",
    sentence: "One ranked list with the whole thread open beside it, the way Leads reads.",
  },
] as const;

export type SeoView = (typeof SEO_VIEWS)[number]["id"];

export const DEFAULT_VIEW: SeoView = "table";

/** The view the URL asks for. Anything else is the default, never an error. */
export function seoView(raw: string | undefined): SeoView {
  return SEO_VIEWS.find((view) => view.id === raw)?.id ?? DEFAULT_VIEW;
}

/**
 * The orders the tab offers. `alpha` is the order the tab used to have and its
 * only one; it is kept because a phrasing you are looking for by name is easier
 * to find alphabetically, and because taking an order away is not an
 * improvement. It is no longer the default.
 */
export const SEO_ORDERS = [
  { id: "score", label: "Best opportunities" },
  { id: "intent", label: "By buyer intent" },
  { id: "google", label: "By Google rank" },
  { id: "alpha", label: "Phrasing A to Z" },
] as const;

export type SeoOrder = (typeof SEO_ORDERS)[number]["id"];

export const DEFAULT_ORDER: SeoOrder = "score";

export function seoOrder(raw: string | undefined): SeoOrder {
  return SEO_ORDERS.find((order) => order.id === raw)?.id ?? DEFAULT_ORDER;
}

/** A number that is missing sorts last whichever way the column is read. */
function last(value: number | null, direction: "asc" | "desc"): number {
  return value ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
}

/**
 * The threads of one phrasing, in the asked-for order. A closed thread sorts
 * after every open one whatever the order, because no reply is possible in it,
 * and that rule is the same one the database applies to the rows underneath.
 */
export function orderThreads(threads: ScoredThread[], order: SeoOrder): ScoredThread[] {
  return [...threads].sort((a, b) => {
    if (a.closed !== b.closed) {
      return a.closed ? 1 : -1;
    }
    if (order === "google") {
      return last(a.position, "asc") - last(b.position, "asc") || b.scored.score - a.scored.score;
    }
    if (order === "intent") {
      return (
        last(b.intent, "desc") - last(a.intent, "desc") ||
        last(b.fit, "desc") - last(a.fit, "desc") ||
        last(a.position, "asc") - last(b.position, "asc")
      );
    }
    // Alphabetical is a phrasing order, so it groups the flat table by phrasing
    // and falls back to worth inside each one. Within a section every thread
    // already shares the phrasing, so there it degrades to the default.
    if (order === "alpha") {
      return (
        a.keyword.localeCompare(b.keyword) ||
        b.scored.score - a.scored.score ||
        last(a.position, "asc") - last(b.position, "asc")
      );
    }
    return b.scored.score - a.scored.score || last(a.position, "asc") - last(b.position, "asc");
  });
}

/** Whether a thread is one of the ones worth acting on, by the one definition. */
export function worthReplying(thread: ScoredThread): boolean {
  return scoreBand(thread.scored) === "strong";
}
