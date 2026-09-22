import { z } from "zod";

/**
 * The shapes the scan reads and stores. Kept apart from the calls that
 * produce them so the code that validates a verdict and the code that asks
 * for one do not import each other.
 */

/**
 * One title's triage. `asking` is the probability the author is looking for
 * something, which is what orders the reading queue; a disposition is the
 * code's reading of it and of the not-a-buyer answer (scan/derive.ts).
 */
export type TriageItem = {
  id: string;
  disposition: "read" | "uncertain" | "reject";
  asking: number;
};

export const REASON_CODES = [
  "supported_open_need",
  "wrong_job",
  "wrong_audience",
  "hard_requirement_mismatch",
  "seller_only",
  "helper_only",
  "no_active_need",
  "resolved",
  "insufficient_evidence",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

const evidenceSchema = z.object({ quote: z.string() });

/**
 * One candidate's assessment as the gates read it and the evaluations table
 * stores it. Since 2026-09-17 no model returns this shape: Jev answers typed
 * questions and scan/derive.ts assembles it, deriving `fit` from three
 * narrow answers and writing `reason` from the rest. `reasonCode` is one code;
 * gates.ts overwrites it with the gate the item failed.
 */
export const assessmentSchema = z.object({
  id: z.string(),
  relationship: z.enum(["buyer", "seller", "helper", "discussion", "unknown"]),
  needState: z.enum(["open", "evaluating", "resolved", "no_active_need", "unknown"]),
  fit: z.number().int().min(0).max(4).nullable(),
  intent: z.number().int().min(0).max(4).nullable(),
  /** How well the product matches the person, 0-1 (derive.ts matchFrom). Null when never judged. */
  match: z.number().min(0).max(1).nullable(),
  stage: z.enum(["none", "problem_aware", "solution_seeking", "comparing", "purchase_ready"]),
  decision: z.enum(["qualify", "review", "reject"]),
  reasonCode: z.enum(REASON_CODES),
  needEvidence: evidenceSchema.nullable(),
  reason: z.string(),
});

/** One item as the model judged it, before any code gate is applied. */
export type Assessment = z.infer<typeof assessmentSchema>;

export type Decision = Assessment["decision"];

/**
 * One judged item as the scan uses it: the model's assessment, the decision the
 * code gates settled on, the engagement computed from the item's own age and
 * comment count, and the 0-100 feed sort order.
 *
 * `matchedPhrase` and `sellerSide` are derived here rather than asked of the
 * model, so the leads table keeps its columns.
 */
export type Judgement = Assessment & {
  engagement: number;
  score: number;
  matchedPhrase: string;
  sellerSide: boolean;
};

/** What the scorer is told about one candidate. */
export type ScorableItem = {
  id: string;
  title: string;
  subreddit: string;
  body: string;
  author: string | null;
  ageHours: number;
  upvotes: number | null;
  numComments: number | null;
  /** The post a comment is a reply to. Null when the item is the post itself. */
  parentBody: string | null;
};

export type TriageCandidate = {
  id: string;
  title: string;
  subreddit: string;
  author: string | null;
  score: number | null;
  ageHours: number;
};
