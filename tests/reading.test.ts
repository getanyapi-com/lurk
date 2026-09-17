import { describe, expect, it, vi } from "vitest";
import type { ScorableItem } from "@/lib/scan/judgement";

/**
 * The shared reading decides which posts the judgement call sees. What matters
 * is which way it errs: only a reading that says the author is not a buyer
 * asking for something may keep a post from the judge, and an absent reading
 * costs a judgement rather than a lead.
 */

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));

vi.mock("@/lib/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jev")>()),
  askJev,
}));
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  }),
}));

const { isAskingBuyer, readPosts, splitByReading } = await import("@/lib/scan/reading");
type Reading = import("@/lib/scan/reading").Reading;

function post(id: string): ScorableItem {
  return {
    id,
    title: "Anyone found a form tool that takes payments?",
    subreddit: "SaaS",
    body: "Ours cannot and we are stuck.",
    author: "asker",
    ageHours: 3,
    upvotes: 5,
    numComments: 1,
    parentBody: null,
  };
}

function read(relationship: string, needState: string) {
  return {
    relationship: relationship as Reading["relationship"],
    needState: needState as Reading["needState"],
    quote: "Ours cannot and we are stuck.",
  };
}

describe("what the shared reading keeps from the judge", () => {
  it("sends a buyer who is asking to the judge and cuts nothing", () => {
    const items = [post("p1")];
    const split = splitByReading(items, new Map([["p1", read("buyer", "open")]]));
    expect(split.toJudge.map((item) => item.id)).toEqual(["p1"]);
    expect(split.cut).toEqual([]);
  });

  /**
   * A reading that is not a buyer asking for something never reaches the judge.
   * What it becomes is the gates' business: a settled disqualifier rejects, and
   * a speaker the reading could not place while it still claims they are asking
   * is held for review, which is the rejection invariant in gates.ts.
   */
  it.each([
    ["seller", "open", "seller_only", "reject"],
    ["helper", "open", "helper_only", "reject"],
    ["buyer", "no_active_need", "no_active_need", "reject"],
    ["buyer", "resolved", "resolved", "reject"],
    ["unknown", "unknown", "insufficient_evidence", "reject"],
    ["discussion", "unknown", "no_active_need", "review"],
  ])("keeps a %s whose need is %s from the judge", (relationship, needState, code, decision) => {
    const split = splitByReading([post("p1")], new Map([["p1", read(relationship, needState)]]));
    expect(split.toJudge).toEqual([]);
    expect(split.cut).toHaveLength(1);
    expect(split.cut[0].id).toBe("p1");
    expect(split.cut[0].decision).toBe(decision);
    expect(split.cut[0].reasonCode).toBe(code);
  });

  it("judges a post the reading could not answer for", () => {
    const split = splitByReading([post("p1")], new Map());
    expect(split.toJudge.map((item) => item.id)).toEqual(["p1"]);
    expect(split.cut).toEqual([]);
  });

  it("sends a buyer still weighing named options to the judge", () => {
    expect(isAskingBuyer(read("buyer", "evaluating"))).toBe(true);
    const split = splitByReading([post("p1")], new Map([["p1", read("buyer", "evaluating")]]));
    expect(split.toJudge.map((item) => item.id)).toEqual(["p1"]);
  });

  it("returns no reading when the model call fails, so the post is judged", async () => {
    askJev.mockReset();
    askJev.mockRejectedValueOnce(new Error("upstream is down"));
    const readings = await readPosts("project", [post("p1")]);
    expect(readings.size).toBe(0);
    expect(splitByReading([post("p1")], readings).toJudge).toHaveLength(1);
  });

  it("never reads a post Reddit has taken away", async () => {
    askJev.mockClear();
    const removed = { ...post("p1"), body: "[deleted]" };
    expect((await readPosts("project", [removed])).size).toBe(0);
    expect(askJev).not.toHaveBeenCalled();
  });
});
