import { describe, expect, it } from "vitest";
import {
  armMetrics, buyerGateFailures, keyed, parseJsonl, reviewPacket, stratifiedTotals, termScreenComparison, validateAdjudication,
  type AuditLabel, type BlindPost, type SnapshotPost,
} from "@/lib/x/audit-eval";
import type { XSignals } from "@/lib/x/gates";
import { reviewHtml } from "../scripts/x-audit-review";

function post(tweet: string, stage: string, conversation = tweet): SnapshotPost {
  return { key: `p:${tweet}`, product: "Product", tweet, text: "Need Calendly. Any alternative?", author: "a", created: "2026-10-01T00:00:00Z", conversation, isReply: false,
    arms: { probe: { stage, freeReject: null, reasonCode: null, score: 90, lane: { family: "probe", label: "term + ask", terms: [["calendly"], ["alternative"]] }, signals: null, level: null, needQuote: null, chainIncomplete: null } } };
}

describe("buyer-first audit", () => {
  it("separates buyers, conversations and unknowns, with conversation dedup only in metrics", () => {
    const posts = [post("1", "lead", "same"), post("2", "lead", "same"), post("3", "reply"), post("4", "reply"), post("5", "lead"), post("6", "pending_reply")];
    const labels = keyed<AuditLabel>([{ key: "p:1", gold: "ask" }, { key: "p:2", gold: "ask" }, { key: "p:3", gold: "reply" }, { key: "p:4", gold: "insufficient" }], "labels");
    expect(armMetrics(posts, labels, "probe")).toMatchObject({ shown: 5, ask: 2, reply: 1, insufficient: 1, unlabelled: 1,
      uniqueBuyerConversations: 1, uniqueUsefulConversations: 1, observedBuyerFraction: 0.5, noiseAmongLabelled: 0, unverifiedAmongLabelled: 1, noiseBounds: [0, 2] });
    expect(armMetrics(posts, labels, "probe", "lead")).toMatchObject({ shown: 3, ask: 2, unlabelled: 1 });
  });

  it("does not let a first no-active-need reason hide other failed gates", () => {
    const signals: XSignals = { ownNeed: 0.1, sameKind: 0.1, rivalVendor: 0.9, resolved: 0.9, automatedAccount: 0.9,
      offersServices: 0.9, curiosity: 0.9, promoting: 0.9, canUse: 0.1, intent: 0, founderWouldReply: 0, replyNeedsProduct: 0 };
    expect(buyerGateFailures(signals, "complete", true, null)).toEqual(["own_need", "same_kind", "rival_vendor", "resolved", "automated_account", "offers_services", "curiosity", "promoting", "can_use", "intent", "chain_incomplete", "missing_need_quote"]);
  });

  it("changes only the term screen when comparing cross-sentence words", () => {
    const row = post("1", "free_rejected");
    expect(termScreenComparison(row, "probe")).toMatchObject({ sentence: false, wholeOwnPost: true });
    row.text = "Any Calendly alternative?";
    expect(termScreenComparison(row, "probe")).toMatchObject({ sentence: true, wholeOwnPost: true });
    row.arms.probe!.lane = null;
    expect(termScreenComparison(row, "probe")).toBeNull();
  });

  it("requires evidence and attribution before importing a positive review", () => {
    expect(() => validateAdjudication({ key: "p:1", gold: "ask", note: "yes", reviewer: "Kevin" })).toThrow("need evidence");
    expect(() => validateAdjudication({ key: "p:1", gold: "ask", note: "yes", reviewer: "Kevin", evidence: { need: "quote", capability: "fact", unresolved: "quote", help: "reason" } })).not.toThrow();
    expect(() => validateAdjudication({ key: "p:1", gold: "insufficient", note: "missing product fit", reviewer: "Kevin" })).not.toThrow();
    expect(() => validateAdjudication({ key: "p:1", gold: "not", note: "promo", reviewer: "" })).toThrow();
  });

  it("preserves legal Unicode line separators in JSONL and rejects duplicate keys", () => {
    expect(parseJsonl<{ text: string }>(' {"text":"before\u2028after"}\n')).toEqual([{ text: "before\u2028after" }]);
    expect(() => keyed([{ key: "same" }, { key: "same" }], "labels")).toThrow("duplicate key");
    expect(() => parseJsonl("broken\n")).toThrow("record 1");
  });
});

describe("sampling uncertainty", () => {
  it("does not claim no buyers from a zero-positive sample", () => {
    const totals = stratifiedTotals([{ product: "Product", unit: "product_post", stratum: "screened", population: 100, sampled: 2, weight: 50, keys: ["1", "2"] }], keyed<AuditLabel>([{ key: "1", gold: "not" }, { key: "2", gold: "not" }], "labels"));
    expect(totals[0].estimate).toBe(0);
    expect(totals[0].envelope![1]).toBeGreaterThan(50);
  });

  it("declines totals with unsampled/missing labels and rejects overlapping strata", () => {
    const stratum = { product: "Product", unit: "product_post", stratum: "screened", population: 100, sampled: 1, weight: 100, keys: ["1"] };
    expect(stratifiedTotals([stratum], new Map())[0].estimate).toBeNull();
    expect(stratifiedTotals([{ ...stratum, sampled: 0, weight: null, keys: [] }], new Map())[0].estimate).toBeNull();
    expect(() => stratifiedTotals([stratum, stratum], new Map())).toThrow("overlap");
    expect(() => stratifiedTotals([{ ...stratum, unit: "conversation" }], new Map())).toThrow();
  });
});

describe("blind review packet", () => {
  it("contains all asks and influential positives but no verdict/weight/reason in the page", () => {
    const posts: BlindPost[] = ["1", "2", "3"].map((id) => ({ key: `p:${id}`, product: { name: "Product", url: null, pain: null, solution: null, targetUsers: null }, post: { text: "</script><script>alert(1)</script>", author: "a", url: "https://x.com/a/status/1", created: "2026-10-01" } }));
    const labels = keyed<AuditLabel>([{ key: "p:1", gold: "ask", note: "secret model note" }, { key: "p:2", gold: "reply" }, { key: "p:3", gold: "not" }], "labels");
    const packet = reviewPacket(posts, labels, { "p:2": 20 }, new Map(), "frozen", 0);
    expect(packet.packet.map((post) => post.key).sort()).toEqual(["p:1", "p:2"]);
    expect(reviewPacket(posts, labels, { "p:2": 20 }, new Map(), "frozen", 0)).toEqual(packet);
    const html = reviewHtml(packet.packet, packet.hash);
    expect(html).not.toContain("secret model note");
    expect(html).not.toContain("all_high_weight_positives");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
