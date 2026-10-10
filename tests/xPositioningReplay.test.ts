import { describe, expect, it } from "vitest";
import type { Answers } from "@/lib/jev";
import type { ProductFacts } from "@/lib/product";
import { assess, candidateState, type XCandidate } from "@/lib/x/judge";
import type { XLevel } from "@/lib/x/gates";
import { briefWarnings, positioningReplay } from "../scripts/lib/x-positioning";

const facts: ProductFacts = {
  name: "Recorder", url: null, pain: "", solution: "", targetUsers: "", serviceGeography: "", budgetFit: "",
  capabilities: ["convert and edit video files", "migrate existing Loom library"], exclusions: [], notBuyers: [], competitors: ["Loom"],
  brief: { kind: "agent-readable recorder", neighbours: [
    { kind: "general screen recorder like Loom", whyNot: "Video only for humans" },
    { kind: "video editing software", whyNot: "Polishes footage" },
    { kind: "bloom arrangement tool", whyNot: "Different task" },
  ], buyers: [], nonBuyers: [], price: "unknown", goodAsks: [], nearMisses: [] },
};
const candidate: XCandidate = {
  tweetId: "1", text: "I'm looking for a screen recorder.", rawText: "I'm looking for a screen recorder.",
  authorUsername: "asker", replyingTo: [], chainIncomplete: false, bio: "Developer",
  createdAt: new Date("2026-10-07T00:00:00Z"), replyCount: null,
};
function answers(over: Record<string, string | number | undefined> = {}): Answers {
  const probabilities = { own_need: 0.9, same_kind: 0.9, rival_vendor: 0.1, resolved: 0.1, automated_account: 0.1,
    offers_services: 0.1, curiosity: 0.1, promoting: 0.1, can_use: 0.9, founder_would_reply: 0.3, reply_needs_product: 0.3, wants_offering: 0.9 };
  const result: Answers = Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, { type: "noul", noul: typeof over[key] === "number" ? over[key] : value }]));
  result.intent = { type: "score", score: typeof over.intent === "number" ? over.intent : 3 };
  for (const [key, value] of Object.entries({ need_quote: "s0", hard_requirement: "met", wanted_kind: "n0" })) {
    result[key] = { type: "choice", choice: typeof over[key] === "string" ? over[key] : value };
  }
  return result;
}
function replay(raw: Answers, level: XLevel = "complete", post = candidate) {
  const sentences = candidateState(facts, post, level).sentences;
  const now = new Date("2026-10-08T00:00:00Z");
  const before = assess(raw, post, sentences, level, now);
  const copy = { ...raw }; delete copy.wanted_kind;
  const diagnostic = assess(copy, post, sentences, level, now);
  return { before, diagnostic, after: positioningReplay(raw, level, before, diagnostic) };
}

describe("offline positioning diagnostics", () => {
  it("flags competitor names at token boundaries and capability overlaps, not substrings", () => {
    const flags = briefWarnings(facts);
    expect(flags.map((flag) => flag.neighbour)).toEqual(["n0", "n1"]);
    expect(flags[0].competitors).toEqual(["Loom"]);
    expect(flags[1].capabilities[0].text).toBe("convert and edit video files");
    expect(briefWarnings({ ...facts, brief: null })).toEqual([]);
  });
  it("keeps contradictory evidence in Maybe instead of qualifying it, without changing the raw answers", () => {
    const raw = answers(); const saved = JSON.stringify(raw);
    const result = replay(raw);
    expect(result.before.stage).toBe("review");
    expect(result.diagnostic.stage).toBe("lead");
    expect(result.after).toEqual({ decision: "review", stage: "review", code: "positioning_conflict" });
    expect(JSON.stringify(raw)).toBe(saved);
  });
  it("does not promote search-level evidence to a complete card", () => {
    expect(replay(answers(), "search").after).toEqual({ decision: "review", stage: "pending_context", code: "positioning_conflict" });
  });
  it.each([
    { hard_requirement: "unknown" }, { hard_requirement: "unmet" }, { wants_offering: 0.2 },
    { rival_vendor: 0.9 }, { promoting: 0.9 }, { automated_account: 0.9 }, { resolved: 0.9 },
    { can_use: 0.2 }, { same_kind: 0.3 }, { own_need: 0.3 }, { intent: 2 }, { need_quote: "none" },
  ])("preserves other blockers: %o", (over) => {
    const result = replay(answers(over));
    expect(result.after).toBe(result.before);
  });
  it("preserves incomplete context even when the recorded scores support an ask", () => {
    const result = replay(answers(), "complete", { ...candidate, chainIncomplete: true });
    expect(result.after).toBe(result.before);
    expect(result.after.code).toBe("insufficient_evidence");
  });
  it("does not treat a missing answer as positioning evidence", () => {
    const raw = answers(); delete raw.wants_offering;
    expect(replay(raw).after.code).not.toBe("positioning_conflict");
    delete raw.wanted_kind;
    const result = replay(raw);
    expect(result.after).toBe(result.before);
  });
});
