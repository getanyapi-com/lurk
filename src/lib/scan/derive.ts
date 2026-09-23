import { choice, noul, score, type Answers } from "@/lib/jev";
import type { Assessment, TriageItem } from "./judgement";
import { leadQuality } from "./leadModel";
import { FIT, INTENT_LEVELS, NEED_STATES, NOTHING, NO_QUOTE, RELATIONSHIPS, REQUIREMENT, STAGES, THIS_PRODUCT } from "./questions";
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
 * lurk's 0-4 fit from five answers. A requirement the product explicitly
 * cannot meet is a wrong job whatever else is true, and so is a job the
 * product does not do, unless the person is its audience, which is overlap
 * at best. Wanting a different kind of product is a wrong job too. A person
 * the product does not serve, or who could not use it, is overlap. Otherwise
 * the requirement decides: met is 4, none stated is 3, and one the facts
 * cannot settle is 2, which the gates hold for review unless the person is
 * asking outright.
 *
 * On 2026-09-19 the audience answer was left out once the product did the job,
 * because gating on it lost 21 of the 143 strongest leads. On 457 production
 * leads labelled 2026-09-20, requiring audience, same kind and can use took
 * the buyer feed from 57% good and 10% bad to 76% good and 3% bad, and kept
 * 150 of the 198 good ones. By then a first sweep found three times the leads,
 * so a wrong lead cost more than a lost one.
 */
export function fitFrom(answers: Answers, prefix: string): number {
  const requirement = oneOf(choice(answers, `${prefix}__hard_requirement`).choice, REQUIREMENT, "unknown");
  if (requirement === "unmet") {
    return 0;
  }
  const audience = noul(answers, `${prefix}__audience`) >= YES;
  if (noul(answers, `${prefix}__solves_problem`) < YES) {
    return audience ? 1 : 0;
  }
  if (noul(answers, `${prefix}__same_kind`) < YES) {
    return 0;
  }
  if (!audience || noul(answers, `${prefix}__can_use`) < YES) {
    return 1;
  }
  return { met: 4, none_stated: 3, unknown: 2 }[requirement];
}

/** One choice answer's probability for an option, from its probabilities or, when absent, its pick. */
function chance(answers: Answers, key: string, option: string): number {
  const answer = choice(answers, key);
  return answer.probabilities ? (answer.probabilities[option] ?? 0) : answer.choice === option ? 1 : 0;
}

/** The chance of each option that passes the test, from its probabilities or, when absent, its pick. */
function chanceOf(answers: Answers, key: string, test: (option: string) => boolean): number[] {
  const answer = choice(answers, key);
  const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
  return Object.entries(probabilities)
    .filter(([option]) => test(option))
    .map(([, value]) => value);
}

/**
 * The numbers the lead model reads, one per answer (scan/leadModel.ts). The
 * brief's features are there only when the product has a brief, and the
 * model fitted without them judges a product that has none.
 */
export function featuresFrom(answers: Answers, prefix: string, withBrief: boolean): Record<string, number> {
  const at = (name: string) => `${prefix}__${name}`;
  const features: Record<string, number> = {
    solves_problem: noul(answers, at("solves_problem")),
    wants_offering: noul(answers, at("wants_offering")),
    same_kind: noul(answers, at("same_kind")),
    can_use: noul(answers, at("can_use")),
    audience: noul(answers, at("audience")),
    intent: score(answers, at("intent")).score,
    req_unmet: chance(answers, at("hard_requirement"), "unmet"),
    req_met: chance(answers, at("hard_requirement"), "met"),
    founder_would_reply: noul(answers, at("founder_would_reply")),
    has_product_pain: noul(answers, at("has_product_pain")),
    promotes_own_thing: noul(answers, at("promotes_own_thing")),
    offers_services: noul(answers, at("offers_services")),
    names_current_tool: noul(answers, at("names_current_tool")),
  };
  if (withBrief) {
    const neighbours = chanceOf(answers, at("wanted_kind"), (option) => /^n\d+$/.test(option));
    features.kind_this = chance(answers, at("wanted_kind"), THIS_PRODUCT);
    features.kind_nothing = chance(answers, at("wanted_kind"), NOTHING);
    features.kind_neighbour_max = Math.max(0, ...neighbours);
    features.group_buyer = chanceOf(answers, at("author_group"), (option) => /^b\d+$/.test(option)).reduce((a, b) => a + b, 0);
    features.group_non_buyer = chanceOf(answers, at("author_group"), (option) => /^x\d+$/.test(option)).reduce((a, b) => a + b, 0);
    features.lead_like = noul(answers, at("is_lead_like"));
  }
  return features;
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
  withBrief = false,
): Assessment {
  const fit = fitFrom(answers, prefix);
  // Someone who would not welcome a product at all has no need of one to act
  // on, however explicit their question: they are asking for advice, not for this.
  const asked = Math.round(score(answers, `${prefix}__intent`).score);
  const intent = noul(answers, `${prefix}__wants_offering`) < YES ? Math.min(asked, 1) : asked;
  return {
    id,
    relationship: reading.relationship,
    needState: reading.needState,
    fit,
    intent,
    quality: leadQuality(featuresFrom(answers, prefix, withBrief), withBrief),
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
