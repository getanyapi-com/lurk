import { GatewayError, createGateway } from "@ai-sdk/gateway";
import { RetryError, experimental_evaluate as evaluate } from "ai";
import { z } from "zod";
import { db } from "@/db";
import { llmUsage } from "@/db/schema";
import { config } from "./config";
import { assertUnderLlmCap, withCallTimeout } from "./llm";

/**
 * TypeSafe's Jev: one state in, typed answers with probabilities out, no
 * generated text. Every scan judgement goes through here. It is asked through
 * Vercel's AI Gateway first when AI_GATEWAY_API_KEY is set, where Jev is free
 * until 2026-09-25 (@vercel_dev, 2026-09-19), and through OpenRouter's
 * Decisions endpoint, on the same key as every muse call, when the Gateway is
 * not configured or fails. The three question types and the answer shapes are
 * the ones in https://docs.typesafe.ai/api.md. Each route bills what it says
 * it billed; the price below, read from Jev's listing on both on 2026-09-18
 * ($0.042 per million input tokens, output free), only covers an answer that
 * leaves the cost out.
 */
export const JEV_PRICE_USD_PER_MILLION_INPUT = 0.042;

/** The last moment of the Gateway's free Jev offer: the end of Sept 25, Pacific time. */
export const GATEWAY_FREE_UNTIL = new Date("2026-09-26T07:00:00Z");

/**
 * How long the Gateway gets before the call moves to OpenRouter. Jev answered
 * 400 calls fired 100 at a time in under 1.2s each (2026-09-19), and in one
 * burst a few calls hung until this cut them off, so a call quiet for 15s is
 * stuck, and the OpenRouter attempt still fits inside the job's heartbeat.
 */
const GATEWAY_TIMEOUT_MS = 15_000;

/**
 * The waits before the Gateway is asked again after a 503. Measured 2026-09-19
 * on 2,047 judge calls, 507 came back 503 in about a second and were paid for
 * on OpenRouter; they arrive in short spells, whatever the request's size, and
 * of 9 met in a probe of 80 calls 8 cleared on the first wait and the last on
 * the second. Nothing else is retried here: a 429 or a timeout moves on.
 */
const GATEWAY_503_WAITS_MS = [400, 1200];

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

/**
 * What an instruction or a criterion may be: a sentence, or a JSON object
 * such as `{ what, not_for, examples }` that pins a fuzzy boundary down with
 * cases on each side (https://docs.typesafe.ai/primitives/advanced.md).
 */
export type Entry = string | { [key: string]: unknown };
export type NoulQuestion = {
  type: "noul";
  instructions: Entry;
  criteria?: { true: Entry; false: Entry };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: Entry;
  /** An option with nothing to say about it takes null; it is sent as "". */
  criteria: Record<string, Entry | null>;
};
export type ScoreQuestion = { type: "score"; instructions: Entry; criteria: Entry[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

const noulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });
/** The Gateway leaves out probabilities and confidence; nothing downstream reads either. */
const choiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});
const scoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
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

/** Raised when the instance has neither a Gateway nor an OpenRouter key, so nothing can be judged. */
export class JevNotConfiguredError extends Error {
  constructor() {
    super("Set AI_GATEWAY_API_KEY or OPENROUTER_API_KEY to let this instance judge leads.");
    this.name = "JevNotConfiguredError";
  }
}

/**
 * Raised when one request carried more than the endpoint reads. OpenRouter
 * lists Jev with a 32k context and passes TypeSafe's refusal through as a 400
 * naming `max_tokens_exceeded` (seen 2026-09-18). Both routes read the same
 * 32k, so this is never retried on the other one: a caller that batches items
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
 * whether it was answered is a query, never a rerun. A Gateway failure writes
 * its own row before the call moves to OpenRouter.
 */
export async function askJev(call: JevCall): Promise<Answers> {
  const { AI_GATEWAY_API_KEY, OPENROUTER_API_KEY } = config();
  if (!AI_GATEWAY_API_KEY && !OPENROUTER_API_KEY) {
    throw new JevNotConfiguredError();
  }
  await assertUnderLlmCap();
  if (AI_GATEWAY_API_KEY) {
    try {
      return await askGateway(AI_GATEWAY_API_KEY, call);
    } catch (error) {
      if (error instanceof JevRequestTooLargeError || !OPENROUTER_API_KEY) {
        throw error;
      }
      console.warn(`[jev] Gateway failed, asking OpenRouter: ${error instanceof Error ? error.message : error}`);
    }
  }
  return askOpenRouter(OPENROUTER_API_KEY!, call);
}

async function askGateway(key: string, call: JevCall): Promise<Answers> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await askGatewayOnce(key, call);
    } catch (error) {
      const wait = GATEWAY_503_WAITS_MS[attempt];
      if (wait === undefined || !GatewayError.isInstance(error) || error.statusCode !== 503) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function askGatewayOnce(key: string, call: JevCall): Promise<Answers> {
  const { JEV_GATEWAY_MODEL } = config();
  const gateway = createGateway({ apiKey: key });
  const startedAt = Date.now();
  let result;
  try {
    result = await withCallTimeout(
      (abortSignal) =>
        evaluate({
          model: gateway.evaluationModel(JEV_GATEWAY_MODEL),
          state: call.state as Parameters<typeof evaluate>[0]["state"],
          questions: toGatewayQuestions(call.questions),
          maxRetries: 0,
          abortSignal,
        }),
      GATEWAY_TIMEOUT_MS,
    );
  } catch (thrown) {
    const error = RetryError.isInstance(thrown) ? thrown.lastError : thrown;
    const status = GatewayError.isInstance(error) ? error.statusCode : null;
    await record(call, {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: JEV_GATEWAY_MODEL,
      provider: "vercel",
      latencyMs: Date.now() - startedAt,
      finishReason: status ? `http_${status}` : error instanceof Error ? error.name : null,
      answered: null,
    });
    if (status === 400 && mentionsTooLarge(error)) {
      throw new JevRequestTooLargeError();
    }
    throw error;
  }
  const answers = fromGatewayAnswers(result.answers, result.providerMetadata);
  const inputTokens = result.usage.inputTokens ?? 0;
  await record(call, {
    inputTokens,
    outputTokens: result.usage.outputTokens ?? 0,
    costUsd: gatewayCost(result.providerMetadata, inputTokens),
    model: result.response.modelId,
    provider: "vercel",
    latencyMs: Date.now() - startedAt,
    finishReason: "answered",
    answered: Object.keys(answers).length,
  });
  return answers;
}

async function askOpenRouter(key: string, call: JevCall): Promise<Answers> {
  const { JEV_MODEL } = config();
  const body = JSON.stringify({
    state: call.state,
    model: JEV_MODEL,
    questions: withoutNullCriteria(call.questions),
  });
  const startedAt = Date.now();
  const response = await withCallTimeout((signal) => post(key, body, signal));
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

type GatewayQuestion = Parameters<typeof evaluate>[0]["questions"][string];
type GatewayResult = Awaited<ReturnType<typeof evaluate>>;

/** The Gateway calls TypeSafe's noul question a boolean; the other two keep their names. */
function toGatewayQuestions(questions: Record<string, Question>): Record<string, GatewayQuestion> {
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      (question.type === "noul"
        ? { type: "boolean" as const, instructions: question.instructions, criteria: question.criteria }
        : question) as GatewayQuestion,
    ]),
  );
}

/**
 * The Gateway's answers in the shape the OpenRouter route returns, so callers
 * never learn which route answered. Confidence, when TypeSafe sends it, rides
 * in provider metadata keyed by question.
 */
function fromGatewayAnswers(
  answers: GatewayResult["answers"],
  metadata: GatewayResult["providerMetadata"],
): Answers {
  const confidence = (metadata?.typesafe as { confidence?: Record<string, unknown> } | undefined)?.confidence;
  const parsed = Object.entries(answers).map(([key, answer]) => {
    const sure = typeof confidence?.[key] === "number" ? (confidence[key] as number) : undefined;
    if (answer.type === "boolean") {
      return [key, noulAnswer.parse({ type: "noul", noul: answer.probability })] as const;
    }
    const schema = answer.type === "choice" ? choiceAnswer : scoreAnswer;
    return [key, schema.parse({ ...answer, confidence: sure })] as const;
  });
  return Object.fromEntries(parsed);
}

/**
 * What the Gateway billed, when it says. When it does not, the call is free
 * inside the offer window and priced at the list price after it.
 */
function gatewayCost(metadata: GatewayResult["providerMetadata"], inputTokens: number): number {
  const reported = Number((metadata?.gateway as { cost?: unknown } | undefined)?.cost);
  if (Number.isFinite(reported)) {
    return reported;
  }
  return Date.now() < GATEWAY_FREE_UNTIL.getTime()
    ? 0
    : (inputTokens * JEV_PRICE_USD_PER_MILLION_INPUT) / 1_000_000;
}

/** Whether a Gateway refusal names the same too-large error OpenRouter passes through. */
function mentionsTooLarge(error: unknown): boolean {
  const cause = (error as { cause?: { responseBody?: unknown } }).cause;
  const text = `${error instanceof Error ? error.message : ""} ${String(cause?.responseBody ?? "")}`;
  return text.includes("max_tokens_exceeded");
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
