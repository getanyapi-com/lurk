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
 * The shorthand used to be a bare adjective - "Fits fully / Asking" - which
 * says nothing about who or what it is describing, so a reader had to already
 * know the rubric to read it. Each word now names its own subject: the intent
 * word is a sentence about the person, the fit word is a sentence about your
 * product, and neither needs the other to make sense.
 */

/** What your product is to this person. Each reads as "<your product> ...". */
const FIT_SHORT: Record<number, string> = {
  0: "Not your product",
  1: "Your crowd, wrong need",
  2: "Maybe your product",
  3: "Your product",
  4: "Your product, exactly",
};

/** Where this person is. Each reads as "this person is ...". */
const INTENT_SHORT: Record<number, string> = {
  0: "Not looking",
  1: "Has the problem",
  2: "Looking for a fix",
  3: "Asking what to use",
  4: "Ready to buy",
};

/** The shorthand for one fit level, or null when nothing judged it. */
export function fitWord(fit: number | null): string | null {
  return fit === null ? null : FIT_SHORT[fit] ?? null;
}

/** The shorthand for one intent level, or null when nothing judged it. */
export function intentWord(intent: number | null): string | null {
  return intent === null ? null : INTENT_SHORT[intent] ?? null;
}

/**
 * The rubric's own sentences for both levels, for a tooltip or a detail pane.
 * Each is labelled with the question it answers and sits on its own line,
 * because two unlabelled clauses run together are the thing the shorthand was
 * already unclear about.
 */
export function judgementSentence(fit: number | null, intent: number | null): string | null {
  if (fit === null && intent === null) {
    return null;
  }
  const lines = [
    intent === null ? null : `Where they are: ${lower(INTENT_LEVELS[intent])}.`,
    fit === null ? null : `Whether you fit: ${lower(FIT[fit])}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** The rubric writes some levels as a sentence, and these read mid-sentence. */
function lower(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}
