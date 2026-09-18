import { describe, expect, it, vi } from "vitest";

/**
 * The boundary every judgement goes through now. What a scan spent and whether
 * the model answered has to be a query against one table, never a rerun, and a
 * request the model refuses as too large has to be told apart from an outage:
 * the first is split and asked again, the second loses the batch.
 */

vi.mock("@/lib/config", () => ({
  config: () => ({
    OPENROUTER_API_KEY: "test-key",
    JEV_MODEL: "jev-test",
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

const { JevRequestTooLargeError, askJev } = await import("@/lib/jev");

const call = {
  purpose: "score",
  projectId: "project-1",
  state: { posts: {} },
  questions: { p0__audience: { type: "noul" as const, instructions: "is this a buyer?" } },
  itemsAsked: 10,
};

function answered(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("what the judgement boundary records", () => {
  it("writes what the batch asked for, what came back, and what it cost", async () => {
    recorded.length = 0;
    vi.stubGlobal(
      "fetch",
      answered({
        model: "jev-1",
        answers: { p0__audience: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      }),
    );

    const answers = await askJev(call);

    expect(answers.p0__audience).toEqual({ type: "noul", noul: 0.9 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      purpose: "score",
      projectId: "project-1",
      provider: "typesafe",
      model: "jev-1",
      inputTokens: 1_000_000,
      itemsAsked: 10,
      itemsAnswered: 1,
      finishReason: "answered",
      schemaFailed: false,
    });
    expect(Number(recorded[0].costUsd)).toBeCloseTo(0.042, 6);
  });

  it("records what OpenRouter billed, and sends an option with no description as empty", async () => {
    recorded.length = 0;
    const fetch = answered({
      model: "typesafe/jev-1",
      provider: "TypeSafe",
      answers: { p0__quote: { type: "choice", choice: "s1", probabilities: { s1: 1 }, confidence: 1 } },
      usage: { input_tokens: 1_000, output_tokens: 20, cost: 0.5 },
    });
    vi.stubGlobal("fetch", fetch);

    await askJev({
      ...call,
      questions: {
        p0__quote: { type: "choice" as const, instructions: "which sentence?", criteria: { s1: null } },
      },
    });

    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.model).toBe("jev-test");
    expect(sent.questions.p0__quote.criteria).toEqual({ s1: "" });
    expect(recorded[0]).toMatchObject({ provider: "TypeSafe", model: "typesafe/jev-1" });
    expect(Number(recorded[0].costUsd)).toBeCloseTo(0.5, 6);
  });

  it("writes a row for a refused request too, and names the request too large", async () => {
    recorded.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"max_tokens_exceeded"}', { status: 400 })),
    );

    await expect(askJev(call)).rejects.toBeInstanceOf(JevRequestTooLargeError);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ purpose: "score", finishReason: "http_400" });
  });

  it("tells any other refusal apart from one it can split", async () => {
    recorded.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream is down", { status: 500 })));

    await expect(askJev(call)).rejects.not.toBeInstanceOf(JevRequestTooLargeError);
    expect(recorded[0]).toMatchObject({ finishReason: "http_500" });
  });
});
