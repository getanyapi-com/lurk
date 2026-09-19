import type { Answers, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "@/lib/jev";
import type { ProductFacts } from "@/lib/product";

/**
 * A Jev answer set as the scan's questions key them, built from one plain
 * spec per candidate, so a test reads as "p0 is a buyer, open, quoting s1,
 * solves 0.9, requirement met, audience 0.8, intent 3.2, solution_seeking"
 * rather than as twelve literal answer objects.
 */

function choiceAnswer(value: string): ChoiceAnswer {
  return { type: "choice", choice: value, probabilities: { [value]: 1 }, confidence: 1 };
}

function noulAnswer(value: number): NoulAnswer {
  return { type: "noul", noul: value };
}

function scoreAnswer(value: number): ScoreAnswer {
  return { type: "score", score: value, probabilities: {}, confidence: 1 };
}

/** What one candidate's reading and judgement answers say. Every field has a default. */
export type JevSpec = {
  relationship?: string;
  needState?: string;
  /** The sentence id the model picked, or "none". */
  quote?: string;
  solvesProblem?: number;
  hardRequirement?: string;
  audience?: number;
  wantsOffering?: number;
  intent?: number;
  stage?: string;
};

/** What one candidate's triage answers say. */
export type TriageSpec = { asking?: number; notBuyer?: string };

/**
 * The reading and judgement answers for these candidates, keyed `p0__...` by
 * the position each one has in the batch, exactly as scan/score.ts asks them.
 */
export function judgeAnswers(specs: JevSpec[], prefix = "p"): Answers {
  const answers: Answers = {};
  specs.forEach((spec, index) => {
    const key = `${prefix}${index}`;
    answers[`${key}__relationship`] = choiceAnswer(spec.relationship ?? "buyer");
    answers[`${key}__need_state`] = choiceAnswer(spec.needState ?? "open");
    answers[`${key}__need_quote`] = choiceAnswer(spec.quote ?? "none");
    answers[`${key}__solves_problem`] = noulAnswer(spec.solvesProblem ?? 0.9);
    answers[`${key}__hard_requirement`] = choiceAnswer(spec.hardRequirement ?? "met");
    answers[`${key}__audience`] = noulAnswer(spec.audience ?? 0.9);
    answers[`${key}__wants_offering`] = noulAnswer(spec.wantsOffering ?? 0.9);
    answers[`${key}__intent`] = scoreAnswer(spec.intent ?? 3);
    answers[`${key}__stage`] = choiceAnswer(spec.stage ?? "solution_seeking");
  });
  return answers;
}

/** The three shared reading answers alone, which is all a reading call asks. */
export function readingAnswers(specs: JevSpec[], prefix = "p"): Answers {
  const all = judgeAnswers(specs, prefix);
  return Object.fromEntries(
    Object.entries(all).filter(([key]) =>
      /__(relationship|need_state|need_quote)$/.test(key),
    ),
  );
}

/** The triage answers for these titles, keyed `c0__...` as scan/score.ts asks them. */
export function triageAnswers(specs: TriageSpec[], prefix = "c"): Answers {
  const answers: Answers = {};
  specs.forEach((spec, index) => {
    const key = `${prefix}${index}`;
    answers[`${key}__asking`] = noulAnswer(spec.asking ?? 0.9);
    answers[`${key}__not_buyer`] = choiceAnswer(spec.notBuyer ?? "none");
  });
  return answers;
}

/** The candidate keys one call asked about, in order, from its questions. */
export function askedKeys(questions: Record<string, unknown>, prefix = "p"): string[] {
  const keys = new Set<string>();
  for (const name of Object.keys(questions)) {
    const [key] = name.split("__");
    if (key.startsWith(prefix)) {
      keys.add(key);
    }
  }
  return [...keys];
}

/** A product every test judges against, with each fact the questions point at. */
export const product: ProductFacts = {
  name: "Formcraft",
  url: "https://formcraft.example",
  pain: "Signup forms cannot branch or take money.",
  solution: "A form builder with conditional logic and payments.",
  targetUsers: "Founders and marketers running their own signup forms",
  serviceGeography: "Worldwide",
  budgetFit: "$20 to $200 a month",
  capabilities: ["conditional logic", "payments", "webhooks"],
  exclusions: ["printing paper forms"],
  notBuyers: ["students doing coursework"],
  competitors: ["Typeform"],
};
