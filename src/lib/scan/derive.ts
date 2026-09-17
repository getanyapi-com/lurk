import { choice, noul, score, type Answers } from "@/lib/jev";
import type { Assessment, TriageItem } from "./judgement";
import { INTENT_LEVELS, NEED_STATES, NO_QUOTE, RELATIONSHIPS, REQUIREMENT, STAGES } from "./questions";
import type { Spans } from "./spans";

/**
 * Typed answers into the assessment the gates read. Fit is not asked as one
 * number: it is derived here from three narrow answers, so a strong job match
 * can never pay for a requirement the product explicitly cannot meet.
 * Measured on the 97 labelled HotelsAllow posts, this derivation with the
 * gates in gates.ts recalled 19 of 19 unanimous leads and agreed on 74 of 75
 * unanimous posts (.context/typesafe/compare3.py, 2026-09-17).
 */

/**
 * A Noul near 0.5 means the model gives yes and no equal probability, so 0.5
 * is the midpoint and nothing else (TypeSafe docs, Noul).
 */
const YES = 0.5;

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The reading of one candidate: who is speaking, and which sentence says what they need. */
export type ReadingAnswers = {
  relationship: Assessment["relationship"];
  needState: Assessment["needState"];
  quote: string | null;
};

export function readingFrom(answers: Answers, prefix: string, sentences: Spans): ReadingAnswers {
  const picked = choice(answers, `${prefix}__need_quote`).choice;
  return {
    relationship: oneOf(choice(answers, `${prefix}__relationship`).choice, RELATIONSHIPS, "unknown"),
    needState: oneOf(choice(answers, `${prefix}__need_state`).choice, NEED_STATES, "unknown"),
    quote: picked === NO_QUOTE ? null : (sentences[picked] ?? null),
  };
}

/**
 * lurk's 0-4 fit from three answers. A requirement the product explicitly
 * cannot meet is a wrong job whatever else is true. A job the product does not
 * do is audience overlap at best. Otherwise the requirement decides: met is 4,
 * none stated is 3, and one the facts cannot settle is 2, which the gates hold
 * for review rather than qualify.
 */
export function fitFrom(answers: Answers, prefix: string): number {
  const requirement = oneOf(choice(answers, `${prefix}__hard_requirement`).choice, REQUIREMENT, "unknown");
  if (requirement === "unmet") {
    return 0;
  }
  if (noul(answers, `${prefix}__solves_problem`) < YES) {
    return noul(answers, `${prefix}__audience`) >= YES ? 1 : 0;
  }
  return { met: 4, none_stated: 3, unknown: 2 }[requirement];
}

const WHO: Record<Assessment["relationship"], string> = {
  buyer: "A buyer",
  seller: "Someone promoting their own thing",
  helper: "Someone answering others",
  discussion: "A discussion with nobody asking",
  unknown: "Someone the post does not identify",
};

const NEED: Record<Assessment["needState"], string> = {
  open: "with an open need",
  evaluating: "weighing options",
  resolved: "whose need is already met",
  no_active_need: "with no need of their own",
  unknown: "whose need the post does not settle",
};

const FIT: Record<number, string> = {
  0: "the product does not do this job",
  1: "the product only overlaps this audience",
  2: "the product plausibly fits but a stated requirement is unknown",
  3: "the product does this job",
  4: "the product does this job and meets the stated requirements",
};

/**
 * The sentence the lead card shows, built from the typed answers. Jev writes
 * no prose, and the sentence only ever named the need, the fit and the
 * decisive blocker, which are all answers.
 */
export function reasonFrom(reading: ReadingAnswers, fit: number, intent: number): string {
  return `${WHO[reading.relationship]} ${NEED[reading.needState]}: ${FIT[fit]}. ${INTENT_LEVELS[intent]}.`;
}

/**
 * The assessment for one candidate, before the gates. `decision` is set to
 * qualify and `reasonCode` to the passing code because gates.ts overwrites
 * both whenever a gate fails; the model is never asked for a verdict.
 */
export function assessmentFrom(
  id: string,
  reading: ReadingAnswers,
  answers: Answers,
  prefix: string,
): Assessment {
  const fit = fitFrom(answers, prefix);
  const intent = Math.round(score(answers, `${prefix}__intent`).score);
  return {
    id,
    relationship: reading.relationship,
    needState: reading.needState,
    fit,
    intent,
    stage: oneOf(choice(answers, `${prefix}__stage`).choice, STAGES, "none"),
    decision: "qualify",
    reasonCode: "supported_open_need",
    needEvidence: reading.quote === null ? null : { quote: reading.quote },
    reason: reasonFrom(reading, fit, intent),
  };
}

/**
 * A title's triage from its two answers. Read when the author looks like they
 * are asking; reject only on a settled not-a-buyer reading of a title that is
 * not asking, the same two disqualifiers the gates settle on; uncertain
 * otherwise, which keeps the title in the queue behind the clear asks.
 */
export function triageFrom(id: string, answers: Answers, prefix: string): TriageItem {
  const asking = noul(answers, `${prefix}__asking`);
  const notBuyer = choice(answers, `${prefix}__not_buyer`).choice;
  if (asking >= YES) {
    return { id, disposition: "read", asking };
  }
  if (notBuyer === "seller" || notBuyer === "helper") {
    return { id, disposition: "reject", asking };
  }
  return { id, disposition: "uncertain", asking };
}
