import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The boundary every model call goes through: what it hands on, and what it
 * leaves behind. A verdict nobody can price, time or blame on a provider is a
 * verdict nobody can argue with, so the row this writes is the whole record of
 * one call - the calls that failed included.
 */

const generateObject = vi.fn();

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject,
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => ({ chat: (model: string, settings?: unknown) => ({ model, settings }) }),
}));
vi.mock("@/lib/config", () => ({
  config: () => ({
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "test-model",
    HOUSE_LLM_CAP_USD_PER_DAY: 10,
  }),
}));

const recorded: Record<string, unknown>[] = [];

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: async () => [{ total: "0" }] }) }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        recorded.push(row);
      },
    }),
  }),
}));

const { NoObjectGeneratedError } = await import("ai");
const { generateStructured } = await import("@/lib/llm");

const schema = z.object({
  verdict: z.object({ quote: z.string() }),
  reasons: z.array(z.string()),
});

/** One answer as the SDK hands it back, with the metadata a row needs, and the bill when OpenRouter sent one. */
function answered(object: unknown, billedUsd?: number) {
  return {
    object,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      outputTokenDetails: { reasoningTokens: 3 },
    },
    finishReason: "stop",
    providerMetadata: {
      openrouter: { provider: "Fireworks", usage: billedUsd === undefined ? {} : { cost: billedUsd } },
    },
    response: { modelId: "served-model" },
  };
}

describe("what the language model boundary hands on", () => {
  /**
   * A model that means an apostrophe sometimes writes the JSON escape for NUL,
   * and the character that lands in the answer is the one Postgres refuses in a
   * jsonb column. The boundary that hands the answer on is where it has to go.
   */
  it("drops a NUL from every string, however deep it sits in the answer", async () => {
    recorded.length = 0;
    generateObject.mockReset();
    generateObject.mockResolvedValue(
      answered({
        verdict: { quote: "it\u0000s free" },
        reasons: ["they\u0000 said they need one"],
      }),
    );

    const answer = await generateStructured({
      purpose: "test",
      projectId: null,
      schema,
      system: "s",
      prompt: "p",
    });

    expect(answer).toEqual({
      verdict: { quote: "its free" },
      reasons: ["they said they need one"],
    });
  });
});

describe("what the language model boundary records", () => {
  it("writes the model, the provider, the reasoning and the shape of the answer", async () => {
    recorded.length = 0;
    generateObject.mockReset();
    generateObject.mockResolvedValue(answered({ verdict: { quote: "hi" }, reasons: [] }));

    await generateStructured({
      purpose: "test",
      projectId: null,
      schema,
      system: "s",
      prompt: "p",
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      purpose: "test",
      model: "served-model",
      provider: "Fireworks",
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 3,
      finishReason: "stop",
      schemaFailed: false,
      itemsAsked: null,
      itemsAnswered: null,
    });
    expect(recorded[0].latencyMs).toBeTypeOf("number");
  });

  it("writes a row for a call whose answer could not be read at all", async () => {
    recorded.length = 0;
    generateObject.mockReset();
    generateObject.mockRejectedValue(
      new NoObjectGeneratedError({
        message: "no object generated",
        text: "sorry",
        response: { id: "r1", modelId: "served-model", timestamp: new Date() },
        usage: {
          inputTokens: 40,
          outputTokens: 0,
          outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          totalTokens: 40,
        },
        finishReason: "stop",
      }),
    );

    await expect(
      generateStructured({ purpose: "test", projectId: null, schema, system: "s", prompt: "p" }),
    ).rejects.toThrow();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      purpose: "test",
      schemaFailed: true,
      inputTokens: 40,
      outputTokens: 0,
      // The error carries the tokens and not the bill, so the table prices it.
      costUsd: "0.000004",
      itemsAnswered: null,
    });
  });

  /**
   * The house cap is a sum of these rows, and OPENROUTER_MODEL can name a model
   * dearer than the one the table was read for. So a row holds what OpenRouter
   * billed, and the table prices only a call that came back without a bill.
   */
  it("records what OpenRouter billed, and prices from the table only without a bill", async () => {
    recorded.length = 0;
    generateObject.mockReset();
    const base = { purpose: "test", projectId: null, schema, system: "s", prompt: "p" };

    generateObject.mockResolvedValueOnce(answered({ verdict: { quote: "q" }, reasons: [] }, 0.0123));
    await generateStructured(base);
    generateObject.mockResolvedValueOnce(answered({ verdict: { quote: "q" }, reasons: [] }));
    await generateStructured(base);

    const model = (generateObject.mock.calls[0][0] as { model: { settings: unknown } }).model;
    expect(model.settings).toEqual({ usage: { include: true } });
    // 10 input tokens at $0.10 and 5 output at $0.20 per million.
    expect(recorded.map((row) => row.costUsd)).toEqual(["0.012300", "0.000002"]);
  });

  /**
   * Effort is the lever on how long a call takes: the onboarding reads and the
   * sweep's searches were measured at half their latency on `minimal`. A call
   * that names one gets it, and one that does not keeps the house default.
   */
  it("asks for the effort a call names, and low when it names none", async () => {
    generateObject.mockReset();
    generateObject.mockResolvedValue(answered({ verdict: { quote: "q" }, reasons: [] }));
    const base = { purpose: "test", projectId: null, schema, system: "s", prompt: "p" };

    await generateStructured({ ...base, effort: "minimal" });
    await generateStructured(base);

    const efforts = generateObject.mock.calls.map(
      (call) => (call[0] as { providerOptions: { openrouter: { reasoning: { effort: string } } } }).providerOptions.openrouter.reasoning.effort,
    );
    expect(efforts).toEqual(["minimal", "low"]);
  });
});
