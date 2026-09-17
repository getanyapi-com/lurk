import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NoObjectGeneratedError, TypeValidationError, generateObject } from "ai";
import { gte, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { llmUsage } from "@/db/schema";
import { HEARTBEAT_MS } from "@/jobs/lease";
import { config } from "./config";

/**
 * OpenRouter's published price for meta/muse-spark-1.3-contributor, read from
 * GET https://openrouter.ai/api/v1/models on 2026-09-05: $0.10 per million
 * input tokens and $0.20 per million output tokens.
 */
export const MODEL_PRICE_USD_PER_MILLION = { input: 0.1, output: 0.2 };

/** Raised when today's house language-model spend is already at its ceiling. */
export class LlmCapReachedError extends Error {
  constructor(capUsd: number) {
    super(
      `Today's language model budget of $${capUsd.toFixed(2)} is used up. Scans resume tomorrow.`,
    );
    this.name = "LlmCapReachedError";
  }
}

/**
 * How long one model call may take. A job's lease lives for LEASE_MS and is
 * re-stamped every HEARTBEAT_MS, so a call that is still silent after one whole
 * heartbeat period is hung: cutting it there ends the job well inside its own
 * lease, and the runner's retry path runs the scan again on its cadence.
 */
export const LLM_CALL_TIMEOUT_MS = HEARTBEAT_MS;

/** Raised when a single model call ran out of time and was cut off. */
export class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `The language model did not answer within ${Math.round(timeoutMs / 60000)} minutes. The scan stopped and will run again.`,
    );
    this.name = "LlmTimeoutError";
  }
}

/**
 * Runs one model call under a deadline. Without this a hung provider holds a
 * job open forever, which is what stalled a scan on 2026-09-06.
 */
export async function withCallTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = LLM_CALL_TIMEOUT_MS,
): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await run(signal);
  } catch (error) {
    if (signal.aborted) {
      throw new LlmTimeoutError(timeoutMs);
    }
    throw error;
  }
}

/**
 * How hard the model thinks before it answers. It cannot be told not to: the
 * endpoint answers `reasoning is mandatory for this endpoint and cannot be
 * disabled` to `reasoning.enabled: false`. It can be turned down, and measured
 * on 2026-09-10 over 100 posts the scan had already judged
 * (.context/probe-judge-effort.ts), low effort costs nothing:
 *
 *   judgement, default   98-115s   94k output tokens   agrees on 96/100
 *   judgement, low       39-41s    41k output tokens   agrees on 96/100
 *
 * Both arms qualified the same posts to within the model's own run-to-run
 * variance, and the default arm varied as much between two runs of itself as
 * the two efforts did from each other. Triage moved the same way: 39.5s
 * against 106.6s, and it keeps more titles, which is the safe direction for a
 * pass whose job is to spend a reading budget rather than to reject anybody.
 */
const REASONING_EFFORT = "low";

/** Raised when the instance has no OpenRouter key, so nothing can be scored. */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super("Set OPENROUTER_API_KEY to let this instance score leads.");
    this.name = "LlmNotConfiguredError";
  }
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** What the house has spent on the language model since midnight UTC. */
export async function llmSpendToday(): Promise<number> {
  const rows = await db()
    .select({ total: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)` })
    .from(llmUsage)
    .where(gte(llmUsage.at, startOfToday()));
  return Number(rows[0]?.total ?? 0);
}

/** Refuses any model call once today's house spend, muse and Jev together, is at the cap. */
export async function assertUnderLlmCap() {
  const cap = config().HOUSE_LLM_CAP_USD_PER_DAY;
  if ((await llmSpendToday()) >= cap) {
    throw new LlmCapReachedError(cap);
  }
}

function costOf(inputTokens: number, outputTokens: number): number {
  const { input, output } = MODEL_PRICE_USD_PER_MILLION;
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

/**
 * A model that means an apostrophe sometimes writes the escape \u0000, and
 * JSON.parse turns that into a NUL character. Postgres accepts no NUL in text
 * or jsonb, so one such quote failed a whole scan on 2026-09-06. Strings are
 * cleaned everywhere they sit in the answer, nested objects and arrays
 * included, before the schema reads them.
 */
export function withoutNulCharacters(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replaceAll("\u0000", "");
  }
  if (Array.isArray(value)) {
    return value.map(withoutNulCharacters);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutNulCharacters(item)]),
    );
  }
  return value;
}

export type LlmCall<T> = {
  purpose: string;
  projectId: string | null;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** How many items a batched call asked for. Absent when it asks for one thing. */
  itemsAsked?: number;
  /** How many of them the answer carried, read off the value that came back. */
  itemsAnswered?: (value: T) => number;
  /** 1 for the first call, 2 for the one asking again for the ids it skipped. */
  attempt?: number;
};

/** What one call left behind, whether it answered or failed. */
type CallRecord = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  model: string;
  provider: string | null;
  latencyMs: number;
  finishReason: string | null;
  schemaFailed: boolean;
  itemsAnswered: number | null;
};

/**
 * The provider OpenRouter routed this call to. It is the one fact a person
 * cannot get any other way: two calls to the same model on the same day can be
 * served by different upstreams, and only one of them may be the slow one.
 */
function providerOf(metadata: unknown): string | null {
  const openrouter = (metadata as { openrouter?: { provider?: unknown } } | undefined)?.openrouter;
  return typeof openrouter?.provider === "string" ? openrouter.provider : null;
}

async function record(call: LlmCall<unknown>, made: CallRecord): Promise<void> {
  await db()
    .insert(llmUsage)
    .values({
      projectId: call.projectId,
      purpose: call.purpose,
      inputTokens: made.inputTokens,
      outputTokens: made.outputTokens,
      reasoningTokens: made.reasoningTokens,
      costUsd: costOf(made.inputTokens, made.outputTokens).toFixed(6),
      model: made.model,
      provider: made.provider,
      latencyMs: made.latencyMs,
      itemsAsked: call.itemsAsked ?? null,
      itemsAnswered: made.itemsAnswered,
      finishReason: made.finishReason,
      schemaFailed: made.schemaFailed,
      attempt: call.attempt ?? null,
    });
}

/**
 * What a failed call is known to have spent. The SDK raises the answer it could
 * not read along with the error, so a call that burned tokens and returned
 * nothing usable is still recorded: an unreadable answer is the most expensive
 * thing a scorer does and the one a person is least likely to hear about.
 */
function spentOnFailure(error: unknown): { input: number; output: number; reasoning: number | null } {
  const usage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
  return {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    reasoning: usage?.outputTokenDetails?.reasoningTokens ?? null,
  };
}

/** True when the call answered, but not in the shape it was asked for. */
function isSchemaFailure(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error);
}

/**
 * One structured language model call, billed to the house and recorded in
 * llm_usage: the daily cap, the Data usage screen and the scorer report all
 * read that one table. Every call writes a row, the failures included, so
 * "what did this scan cost and did it answer" is a query and never a rerun.
 */
export async function generateStructured<T>(call: LlmCall<T>): Promise<T> {
  const { OPENROUTER_API_KEY, OPENROUTER_MODEL } = config();
  if (!OPENROUTER_API_KEY) {
    throw new LlmNotConfiguredError();
  }
  await assertUnderLlmCap();
  const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
  const startedAt = Date.now();
  let result;
  try {
    result = await withCallTimeout((abortSignal) =>
      generateObject({
        model: openrouter.chat(OPENROUTER_MODEL),
        schema: call.schema,
        system: call.system,
        prompt: call.prompt,
        providerOptions: { openrouter: { reasoning: { effort: REASONING_EFFORT } } },
        abortSignal,
      }),
    );
  } catch (error) {
    const spent = spentOnFailure(error);
    await record(call as LlmCall<unknown>, {
      inputTokens: spent.input,
      outputTokens: spent.output,
      reasoningTokens: spent.reasoning,
      model: OPENROUTER_MODEL,
      provider: null,
      latencyMs: Date.now() - startedAt,
      finishReason: error instanceof Error ? error.name : null,
      schemaFailed: isSchemaFailure(error),
      itemsAnswered: null,
    });
    throw error;
  }
  const value = call.schema.parse(withoutNulCharacters(result.object));
  await record(call as LlmCall<unknown>, {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? null,
    model: result.response?.modelId ?? OPENROUTER_MODEL,
    provider: providerOf(result.providerMetadata),
    latencyMs: Date.now() - startedAt,
    finishReason: result.finishReason ?? null,
    schemaFailed: false,
    itemsAnswered: call.itemsAnswered ? call.itemsAnswered(value) : null,
  });
  return value;
}
