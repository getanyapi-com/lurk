import { FIT, INTENT_LEVELS } from "./questions";

/**
 * The two answers the model actually gave, in words a person reads.
 *
 * A lead's folded score is a sort order and nothing else: a fifth of it is a
 * freshness clock, so a perfect fit with an explicit ask reads 70 once the
 * thread is three days old, and a person reading 70 concludes there is nothing
 * good in the feed. The words never say that, because they only ever repeat
 * what was asked and answered.
 *
 * Two forms of each level, from the one legend: the sentence the rubric uses,
 * and a shorthand that fits a feed row beside a title and an age.
 */

const FIT_SHORT: Record<number, string> = {
  0: "Wrong job",
  1: "Audience only",
  2: "Maybe fits",
  3: "Fits",
  4: "Fits fully",
};

const INTENT_SHORT: Record<number, string> = {
  0: "No need",
  1: "Has the pain",
  2: "Exploring",
  3: "Asking",
  4: "Deciding",
};

/** The shorthand for one fit level, or null when nothing judged it. */
export function fitWord(fit: number | null): string | null {
  return fit === null ? null : FIT_SHORT[fit] ?? null;
}

/** The shorthand for one intent level, or null when nothing judged it. */
export function intentWord(intent: number | null): string | null {
  return intent === null ? null : INTENT_SHORT[intent] ?? null;
}

/** The rubric's own sentence for both levels, for a tooltip or a detail pane. */
export function judgementSentence(fit: number | null, intent: number | null): string | null {
  if (fit === null && intent === null) {
    return null;
  }
  const parts = [fit === null ? null : FIT[fit], intent === null ? null : INTENT_LEVELS[intent]];
  return parts.filter(Boolean).join(". ") + ".";
}
