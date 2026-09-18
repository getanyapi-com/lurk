import { z } from "zod";
import { db } from "@/db";
import { llmUsage } from "@/db/schema";
import { config } from "./config";
import { assertUnderLlmCap, withCallTimeout } from "./llm";

/**
 * TypeSafe's Jev: one state in, typed answers with probabilities out, no
 * generated text. Every scan judgement goes through here. It is reached through
 * OpenRouter's Decisions endpoint, on the same key as every muse call; the
 * three question types and the answer shapes are the ones in
 * https://docs.typesafe.ai/api.md. OpenRouter bills what OpenRouter says in
 * `usage.cost`; the price below, read from its Jev 1.13 listing on 2026-09-18
 * ($0.042 per million input tokens, output free), only covers an answer that
 * leaves the cost out.
 */
export const JEV_PRICE_USD_PER_MILLION_INPUT = 0.042;

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  /** An option with nothing to say about it takes null; it is sent as "". */
  criteria: Record<string, string | null>;
};
export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

const noulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });
const choiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});
const scoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.discriminatedUnion("type", [noulAnswer, choiceAnswer, scoreAnswer])),
  provider: z.string().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cost: z.number().optional(),
  }),
});

export type NoulAnswer = z.infer<typeof noulAnswer>;
export type ChoiceAnswer = z.infer<typeof choiceAnswer>;
export type ScoreAnswer = z.infer<typeof scoreAnswer>;
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

/** Raised when the instance has no OpenRouter key, so nothing can be judged. */
export class JevNotConfiguredError extends Error {
  constructor() {
    super("Set OPENROUTER_API_KEY to let this instance judge leads.");
    this.name = "JevNotConfiguredError";
  }
}

/**
 * Raised when one request carried more than the endpoint reads. OpenRouter
 * lists Jev with a 32k context and passes TypeSafe's refusal through as a 400
 * naming `max_tokens_exceeded` (seen 2026-09-18). A caller that batches items
 * splits the batch and asks again.
 */
export class JevRequestTooLargeError extends Error {
  constructor() {
    super("The request was larger than the model reads in one call.");
    this.name = "JevRequestTooLargeError";
  }
}

export type JevCall = {
  purpose: string;
  projectId: string | null;
  state: unknown;
  questions: Record<string, Question>;
  /** How many items a batched call asked about. Absent when it asks about one thing. */
  itemsAsked?: number;
};

/**
 * The statuses TypeSafe's docs say to retry with backoff, and the retry count
 * the probe that measured the model ran clean with (.context/typesafe/probe3.py).
 */
const RETRY_STATUSES = new Set([429, 529]);
const RETRIES = 3;

async function post(key: string, body: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
      signal,
    });
    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRIES) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    signal.throwIfAborted();
  }
}

async function record(
  call: JevCall,
  made: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | undefined;
    model: string;
    provider: string | null;
    latencyMs: number;
    finishReason: string | null;
    answered: number | null;
  },
): Promise<void> {
  await db()
    .insert(llmUsage)
    .values({
      projectId: call.projectId,
      purpose: call.purpose,
      inputTokens: made.inputTokens,
      outputTokens: made.outputTokens,
      reasoningTokens: null,
      costUsd: (made.costUsd ?? (made.inputTokens * JEV_PRICE_USD_PER_MILLION_INPUT) / 1_000_000).toFixed(6),
      model: made.model,
      provider: made.provider,
      latencyMs: made.latencyMs,
      itemsAsked: call.itemsAsked ?? null,
      itemsAnswered: made.answered,
      finishReason: made.finishReason,
      schemaFailed: false,
      attempt: 1,
    });
}

/**
 * One Jev request, billed to the house and recorded in llm_usage beside every
 * muse call, so the daily cap, the Data usage screen and the scorer report
 * read one table. A refused request writes a row too: what a scan spent and
 * whether it was answered is a query, never a rerun.
 */
export async function askJev(call: JevCall): Promise<Answers> {
  const { OPENROUTER_API_KEY, JEV_MODEL } = config();
  if (!OPENROUTER_API_KEY) {
    throw new JevNotConfiguredError();
  }
  await assertUnderLlmCap();
  const body = JSON.stringify({
    state: call.state,
    model: JEV_MODEL,
    questions: withoutNullCriteria(call.questions),
  });
  const startedAt = Date.now();
  const response = await withCallTimeout((signal) => post(OPENROUTER_API_KEY, body, signal));
  const text = await response.text();
  if (!response.ok) {
    await record(call, {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: JEV_MODEL,
      provider: null,
      latencyMs: Date.now() - startedAt,
      finishReason: `http_${response.status}`,
      answered: null,
    });
    if (response.status === 400 && text.includes("max_tokens_exceeded")) {
      throw new JevRequestTooLargeError();
    }
    throw new Error(`Jev answered ${response.status}: ${text.slice(0, 200)}`);
  }
  const parsed = responseSchema.parse(JSON.parse(text));
  await record(call, {
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    costUsd: parsed.usage.cost,
    model: parsed.model,
    provider: parsed.provider ?? "typesafe",
    latencyMs: Date.now() - startedAt,
    finishReason: "answered",
    answered: Object.keys(parsed.answers).length,
  });
  return parsed.answers;
}

/**
 * TypeSafe reads a null choice criterion as an option with no description;
 * OpenRouter's schema refuses null and takes "" for the same thing.
 */
function withoutNullCriteria(questions: Record<string, Question>): Record<string, Question> {
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

/** The answer under `key`, as the type it was asked as. */
export function noul(answers: Answers, key: string): number {
  const answer = answers[key];
  if (answer?.type !== "noul") {
    throw new Error(`No noul answer for ${key}`);
  }
  return answer.noul;
}

export function choice(answers: Answers, key: string): ChoiceAnswer {
  const answer = answers[key];
  if (answer?.type !== "choice") {
    throw new Error(`No choice answer for ${key}`);
  }
  return answer;
}

export function score(answers: Answers, key: string): ScoreAnswer {
  const answer = answers[key];
  if (answer?.type !== "score") {
    throw new Error(`No score answer for ${key}`);
  }
  return answer;
}
