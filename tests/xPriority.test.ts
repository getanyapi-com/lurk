import { describe, expect, it } from "vitest";
import { expectedXIntent, rankXOpportunities, xPriority } from "@/lib/x/priority";

const noul = (noul: number) => ({ type: "noul", noul });
const signals = (over: Record<string, unknown> = {}) => ({
  own_need: noul(0.95), same_kind: noul(0.8), supported_job: noul(0.9),
  intent: { type: "score", score: 3.1 }, rival_vendor: noul(0.05), promoting: noul(0.05), resolved: noul(0.05),
  hard_requirement: { type: "choice", choice: "none_stated" }, ...over,
});

describe("cached X attention priority", () => {
  it("uses graded intent when available and the raw score when the gateway omits distributions", () => {
    expect(expectedXIntent({ type: "score", score: 3, probabilities: { 2: 0.4, 3: 0.6 } })).toBeCloseTo(2.6);
    expect(expectedXIntent({ type: "score", score: 2.83 })).toBe(2.83);
    expect(expectedXIntent({ type: "score", score: 2.83, probabilities: { bad: 1 } })).toBe(2.83);
    expect(expectedXIntent({ type: "score", score: 2.83, probabilities: { 4: 0.2 } })).toBe(2.83);
    expect(expectedXIntent({ type: "score", score: Infinity })).toBeNull();
  });

  it("does not invent a priority from missing or invalid evidence", () => {
    for (const value of [null, [], "a score", signals({ own_need: noul(NaN) }), signals({ intent: null })]) {
      expect(xPriority({ signals: value, level: "complete" }).priority).toBeNull();
    }
  });

  it("keeps supported basic jobs and unknown context without a commercial-use penalty", () => {
    const basic = signals({ same_kind: noul(0.4), supported_job: noul(0.95) });
    const complete = xPriority({ signals: basic, level: "complete" });
    const unknown = xPriority({ signals: { ...basic, hard_requirement: { type: "choice", choice: "unknown" } }, level: "search" });
    expect(unknown.priority).toBe(complete.priority);
    expect(unknown.checks).toEqual(["Check author and context", "Check requirements"]);
    expect(complete.priority).toBeGreaterThan(0.4);
  });

  it("demotes promotions, solved needs and failed reply checks despite high intent/fit", () => {
    const good = xPriority({ signals: signals(), level: "complete" }).priority!;
    for (const over of [
      { rival_vendor: noul(0.99) }, { promoting: noul(0.99) }, { resolved: noul(0.99) },
      { reply: { worth_reply: false, code: "not_reply_worthy" } },
      { hard_requirement: { type: "choice", choice: "unmet" } },
    ]) expect(xPriority({ signals: signals(over), level: "complete" }).priority!).toBeLessThan(good / 2);
  });

  it("retains checked public reply venues without treating an unverified high reply signal as enough", () => {
    const venue = signals({ own_need: noul(0), promoting: noul(0.9), founder_would_reply: noul(0.98) });
    expect(xPriority({ signals: venue, level: "search" }).priority).toBe(0);
    expect(xPriority({ signals: { ...venue, reply: { worth_reply: true } }, level: "search" }).priority).toBeGreaterThan(0.4);
  });

  it("ranks before author dedupe, keeps unknown scores last, and keeps every history post", () => {
    const input = (key: string, author: string, raw: unknown, newer = false) => ({
      key, author, signals: raw, postedAt: new Date(newer ? "2026-10-09" : "2026-10-02"), level: "complete", engagement: 3,
    });
    const rows = [input("newerWeak", "SAME", signals({ own_need: noul(0.2) }), true), input("olderAsk", "same", signals()), input("unscored", "other", null, true)];
    expect(rankXOpportunities(rows).map((x) => x.key)).toEqual(["olderAsk", "unscored"]);
    expect(rankXOpportunities(rows, false)).toHaveLength(3);
  });
});
