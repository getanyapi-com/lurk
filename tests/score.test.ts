import { describe, expect, it, vi } from "vitest";
import { judgeAnswers, product, triageAnswers } from "./jevAnswers";

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));

vi.mock("@/lib/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jev")>()),
  askJev,
}));

const { judgeItems, triageTitles } = await import("@/lib/scan/score");
const { SCORE_BATCH_SIZE, TRIAGE_BATCH_SIZE } = await import("@/lib/scan/constants");

function candidates(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    id: `p${index}`,
    title: `title ${index}`,
    subreddit: "hotels",
    author: "someone",
    score: 1,
    ageHours: 10,
  }));
}

describe("triage over many batches", () => {
  /**
   * One dropped connection on batch 48 of 51 threw away a whole sweep's triage
   * on 2026-09-10. A batch the model never answered has to mean the same as a
   * batch it answered with nothing: unread, never rejected.
   */
  it("keeps the other batches when one batch's model call fails", async () => {
    const all = candidates(TRIAGE_BATCH_SIZE * 3);
    let calls = 0;
    askJev.mockReset();
    askJev.mockImplementation(async (call: { itemsAsked: number }) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("terminated");
      }
      return triageAnswers(Array.from({ length: call.itemsAsked }, () => ({ asking: 0.9 })));
    });

    const out = await triageTitles("project", product, all);

    expect(out).toHaveLength(all.length);
    expect(out.filter((item) => item.disposition === "read")).toHaveLength(TRIAGE_BATCH_SIZE * 2);
    const unread = out.filter((item) => item.disposition === "uncertain");
    expect(unread).toHaveLength(TRIAGE_BATCH_SIZE);
    expect(unread.every((item) => item.asking === 0)).toBe(true);
  });

  it("asks the batches at once, not one after another", async () => {
    let live = 0;
    let peak = 0;
    askJev.mockReset();
    askJev.mockImplementation(async (call: { itemsAsked: number }) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return triageAnswers(Array.from({ length: call.itemsAsked }, () => ({ asking: 0.1 })));
    });

    await triageTitles("project", product, candidates(TRIAGE_BATCH_SIZE * 4));

    expect(peak).toBeGreaterThan(1);
  });
});

function scorable(n: number) {
  return Array.from({ length: n }, (_, index) => ({
    id: `p${index}`,
    title: `title ${index}`,
    subreddit: "hotels",
    body: "I am 19 and need a room",
    author: "someone",
    ageHours: 10,
    upvotes: 1,
    numComments: 0,
    parentBody: null,
  }));
}

describe("committing verdicts while the sweep is still judging", () => {
  function answers() {
    askJev.mockReset();
    askJev.mockImplementation(async (call: { itemsAsked: number }) =>
      judgeAnswers(Array.from({ length: call.itemsAsked }, () => ({ quote: "s0" }))),
    );
  }

  it("hands each batch over as it lands, not once at the end", async () => {
    answers();
    const sizes: number[] = [];

    await judgeItems(
      "project",
      product,
      scorable(SCORE_BATCH_SIZE * 3),
      new Map(),
      async (batch) => {
        sizes.push(batch.length);
      },
    );

    expect(sizes).toEqual([SCORE_BATCH_SIZE, SCORE_BATCH_SIZE, SCORE_BATCH_SIZE]);
  });

  /**
   * The caller writes whatever is still uncommitted from the returned list, so
   * a batch whose commit threw is written at the end instead of being lost.
   */
  it("still returns a batch whose commit failed", async () => {
    answers();
    let seen = 0;

    const out = await judgeItems(
      "project",
      product,
      scorable(SCORE_BATCH_SIZE * 2),
      new Map(),
      async () => {
        seen += 1;
        throw new Error("the database was busy");
      },
    );

    expect(seen).toBe(2);
    expect(out).toHaveLength(SCORE_BATCH_SIZE * 2);
  });
});
