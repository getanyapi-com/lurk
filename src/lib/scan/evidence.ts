import type { ScorableItem } from "./judgement";

/**
 * The text each model call sees, and nothing else. The quote validator checks
 * the model's evidence against exactly the string built here, so what the model
 * was allowed to read and what it is allowed to quote cannot drift apart.
 */

/** The most characters of one body the scorer is given. */
export const BODY_CHAR_BUDGET = 3000;

/** The most characters of a comment's parent post the scorer is given. */
export const PARENT_CHAR_BUDGET = 1200;

const ELISION = "\n[...]\n";

/**
 * Reddit text in the plain characters a model quotes back reliably. Curly
 * quotes, typographic dashes and stray control characters are what the model
 * garbled on a perfect lead: it returned "wouldn\u00191" for a curly
 * "wouldn't", so the quote failed verification and the buyer sat on the held
 * list. The model never sees the curly forms now, so it cannot mangle them.
 */
export function plainTypography(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Keeps the head and the tail of a long body. Reddit puts the edit, the update
 * and the "solved, thanks" at the end, so a head-only cut removes exactly the
 * evidence that would reject the lead.
 */
export function truncateBody(body: string, budget = BODY_CHAR_BUDGET): string {
  if (body.length <= budget) {
    return body;
  }
  const head = Math.ceil(budget / 2);
  const tail = budget - head;
  return `${body.slice(0, head)}${ELISION}${body.slice(body.length - tail)}`;
}

/**
 * The target person's own words, cut and uncut. A need quote is checked against
 * this and never against the whole formatted candidate, because that string
 * carries the parent post a comment is replying to: a commenter who quotes the
 * parent has produced evidence of somebody else's need, not their own.
 */
export function ownTexts(item: ScorableItem): string[] {
  return [item.title, truncateBody(item.body), item.body].map(plainTypography);
}

/** Reddit's own markers for a body or an author it has taken away. */
const SENTINEL_BODIES = ["[deleted]", "[removed]"];
const SENTINEL_AUTHOR = "[deleted]";

/**
 * True when Reddit has taken the content away. There is nothing here for a
 * model to read and nothing for a person to answer, so such an item is never
 * triaged, never judged, and never stored as a verdict about anybody.
 */
export function isSentinel(item: { body: string | null; author: string | null }): boolean {
  const body = (item.body ?? "").trim().toLowerCase();
  const author = (item.author ?? "").trim().toLowerCase();
  return SENTINEL_BODIES.includes(body) || author === SENTINEL_AUTHOR;
}
