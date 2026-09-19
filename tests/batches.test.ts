import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jev", () => ({
  JevRequestTooLargeError: class JevRequestTooLargeError extends Error {},
}));
vi.mock("@/lib/llm", () => ({ LlmCapReachedError: class LlmCapReachedError extends Error {} }));

const { STATE_TOKEN_BUDGET, pack, stateTokens } = await import("@/lib/scan/batches");

/**
 * Jev refuses a request whose state is over its token ceiling, and every
 * refusal is a round trip spent learning the batch was too big. Batches close
 * on the budget before they are sent, so a scan of long posts is not refused
 * and halved over and over.
 */
describe("packing candidates into requests", () => {
  it("closes a batch at the count when the items are small", () => {
    const batches = pack(Array.from({ length: 25 }, (_, i) => i), 10, () => 1);
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
  });

  it("closes a batch at the token budget before the count", () => {
    const heavy = STATE_TOKEN_BUDGET / 4;
    const batches = pack(Array.from({ length: 10 }, (_, i) => i), 10, () => heavy);
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 2]);
  });

  it("sends an item over the budget on its own", () => {
    const weights = [100, STATE_TOKEN_BUDGET * 2, 100];
    const batches = pack([0, 1, 2], 10, (i) => weights[i]);
    expect(batches).toEqual([[0], [1], [2]]);
  });

  it("keeps the items in their order", () => {
    const batches = pack([1, 2, 3, 4, 5], 2, () => 1);
    expect(batches.flat()).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts state high rather than low", () => {
    const title = { subreddit: "startups", title: "Anyone using a tool to find leads on Reddit?", author: "u1", upvotes: 3, age_hours: 5 };
    // Jev read title-shaped state at 2.3 characters a token.
    expect(stateTokens(title)).toBeGreaterThanOrEqual(Math.ceil(JSON.stringify(title).length / 2.3));
  });
});
