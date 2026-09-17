import { ownTexts } from "./evidence";
import { downgradeToReview } from "./gates";
import type { Judgement, ScorableItem } from "./judgement";

/**
 * A typed answer proves the shape of a verdict, never its truth. This check
 * proves the one thing the shape cannot: that every quote is really in the
 * text of the person it is about.
 */

/**
 * One text as a quote can be compared against it. Reddit and the model disagree
 * about typography, never about words: the body carries smart quotes, dashes
 * and the backslashes Reddit escapes markdown with, and the model returns the
 * plain characters. Whitespace runs collapse for the same reason.
 */
function normalize(text: string): string {
  return text
    .replace(/\\([^\p{L}\p{N}\s])/gu, "$1")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips what a model adds around a quote without meaning to change it. */
function bare(quote: string): string {
  return normalize(quote)
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .replace(/(\.\.\.|\u2026)$/, "")
    .trim();
}

/** True when the quote really is in one of the supplied texts, typography aside. */
export function isVerbatim(quote: string, supplied: string[]): boolean {
  const needle = bare(quote);
  return needle.length > 0 && supplied.some((text) => normalize(text).includes(needle));
}

/**
 * A judgement whose need quote is not in the target person's own words goes to
 * review, not to the feed. So does a qualified lead with no quote at all: the
 * feed card is built out of that quote. The parent post a comment replies to is
 * deliberately not searched, so a commenter who quoted the person they are
 * answering is held rather than sold as a buyer.
 */
export function withCheckedEvidence(item: Judgement, source: ScorableItem): Judgement {
  const own = ownTexts(source);
  const unquoted = item.decision === "qualify" && !item.needEvidence;
  if (unquoted || (item.needEvidence && !isVerbatim(item.needEvidence.quote, own))) {
    return downgradeToReview(item, "insufficient_evidence");
  }
  return item;
}
