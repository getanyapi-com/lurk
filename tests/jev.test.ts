import { describe, expect, it, vi } from "vitest";

/**
 * The boundary every judgement goes through now. What a scan spent and whether
 * the model answered has to be a query against one table, never a rerun, and a
 * request the model refuses as too large has to be told apart from an outage:
 * the first is split and asked again, the second loses the batch.
 */

const settings: Record<string, unknown> = {
  OPENROUTER_API_KEY: "test-key",
  JEV_MODEL: "jev-test",
  JEV_GATEWAY_MODEL: "typesafe-ai/jev",
  HOUSE_LLM_CAP_USD_PER_DAY: 10,
};

vi.mock("@/lib/config", () => ({ config: () => settings }));

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

const { JevNotConfiguredError, JevRequestTooLargeError, askJev } = await import("@/lib/jev");

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

/** A fetch that answers the Gateway and OpenRouter differently, and remembers who it was asked. */
function twoRoutes(gateway: () => Response, openrouter: () => Response) {
  return vi.fn(async (url: string | URL) =>
    String(url).includes("ai-gateway.vercel.sh") ? gateway() : openrouter(),
  );
}

const openrouterAnswer = () =>
  new Response(
    JSON.stringify({
      model: "jev-1",
      answers: { p0__audience: { type: "noul", noul: 0.4 } },
      usage: { input_tokens: 100, output_tokens: 0 },
    }),
  );

describe("the Gateway first, OpenRouter behind it", () => {
  it("asks the Gateway a noul as a boolean and hands back a noul", async () => {
    recorded.length = 0;
    settings.AI_GATEWAY_API_KEY = "vck_test";
    const fetch = twoRoutes(
      () =>
        new Response(
          JSON.stringify({
            answers: { p0__audience: { type: "boolean", probability: 0.9 } },
            usage: { inputTokens: 500, outputTokens: 0 },
          }),
        ),
      openrouterAnswer,
    );
    vi.stubGlobal("fetch", fetch);

    const answers = await askJev(call);

    expect(answers.p0__audience).toEqual({ type: "noul", noul: 0.9 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.questions.p0__audience.type).toBe("boolean");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ provider: "vercel", inputTokens: 500, finishReason: "answered", itemsAnswered: 1 });
  });

  it("moves to OpenRouter when the Gateway fails, and records both", async () => {
    recorded.length = 0;
    settings.AI_GATEWAY_API_KEY = "vck_test";
    vi.stubGlobal(
      "fetch",
      twoRoutes(
        () => new Response(JSON.stringify({ error: { message: "no credits", type: "insufficient_funds" } }), { status: 402 }),
        openrouterAnswer,
      ),
    );

    const answers = await askJev(call);

    expect(answers.p0__audience).toEqual({ type: "noul", noul: 0.4 });
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ provider: "vercel", finishReason: "http_402" });
    expect(recorded[1]).toMatchObject({ provider: "typesafe", finishReason: "answered" });
  });

  it("asks the Gateway again after a 503 before paying OpenRouter", async () => {
    recorded.length = 0;
    settings.AI_GATEWAY_API_KEY = "vck_test";
    let asked = 0;
    const fetch = twoRoutes(() => {
      asked += 1;
      return asked === 1
        ? new Response(JSON.stringify({ error: { message: "unavailable", type: "service_unavailable" } }), { status: 503 })
        : new Response(
            JSON.stringify({
              answers: { p0__audience: { type: "boolean", probability: 0.9 } },
              usage: { inputTokens: 500, outputTokens: 0 },
            }),
          );
    }, openrouterAnswer);
    vi.stubGlobal("fetch", fetch);

    const answers = await askJev(call);

    expect(answers.p0__audience).toEqual({ type: "noul", noul: 0.9 });
    expect(recorded.map((row) => `${row.provider}:${row.finishReason}`)).toEqual(["vercel:http_503", "vercel:answered"]);
  });

  it("asks the Gateway first every time, even after it rate-limits", async () => {
    recorded.length = 0;
    settings.AI_GATEWAY_API_KEY = "vck_test";
    const fetch = twoRoutes(
      () => new Response(JSON.stringify({ error: { message: "Free tier requests on this model are rate-limited.", type: "rate_limit_exceeded" } }), { status: 429 }),
      openrouterAnswer,
    );
    vi.stubGlobal("fetch", fetch);

    await askJev(call);
    await askJev(call);

    const gatewayCalls = fetch.mock.calls.filter(([url]) => String(url).includes("ai-gateway.vercel.sh"));
    expect(gatewayCalls).toHaveLength(2);
    expect(recorded.map((row) => `${row.provider}:${row.finishReason}`)).toEqual([
      "vercel:http_429",
      "typesafe:answered",
      "vercel:http_429",
      "typesafe:answered",
    ]);
  });

  it("does not ask OpenRouter again for a request too large for either", async () => {
    recorded.length = 0;
    settings.AI_GATEWAY_API_KEY = "vck_test";
    const fetch = twoRoutes(
      () => new Response(JSON.stringify({ error: { message: "max_tokens_exceeded", type: "invalid_request_error" } }), { status: 400 }),
      openrouterAnswer,
    );
    vi.stubGlobal("fetch", fetch);

    await expect(askJev(call)).rejects.toBeInstanceOf(JevRequestTooLargeError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
  });

  it("refuses to run with neither key", async () => {
    settings.AI_GATEWAY_API_KEY = undefined;
    settings.OPENROUTER_API_KEY = undefined;
    await expect(askJev(call)).rejects.toBeInstanceOf(JevNotConfiguredError);
    settings.OPENROUTER_API_KEY = "test-key";
  });
});
