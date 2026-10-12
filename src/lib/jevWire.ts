/** Shared pure OpenRouter wire contract. No environment, DB or network imports. */
import { z } from "zod";
import type { Question } from "./jev";

export const noulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });
/** The Gateway may omit probabilities; priority falls back to the unrounded score. */
export const choiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});
export const scoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});
export const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.discriminatedUnion("type", [noulAnswer, choiceAnswer, scoreAnswer])),
  provider: z.string().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cost: z.number().optional(),
  }),
});
/** Null describes an option without prose; OpenRouter accepts "" instead. */
export function withoutNullCriteria(questions: Record<string, Question>): Record<string, Question> {
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      question.type === "choice"
        ? {
            ...question,
            criteria: Object.fromEntries(
              Object.entries(question.criteria).map(([option, text]) => [option, text ?? ""]),
            ),
          }
        : question,
    ]),
  );
}
