import { describe, expect, it } from "vitest";
import type { Answers } from "@/lib/jev";
import type { ProductFacts } from "@/lib/product";
import { REPLY_FWR, decide, foldScore, replyCandidate, replyRoute, replyScore, stageFor, venueCandidate, venueScore, type XSignals } from "@/lib/x/gates";
import { assess, candidateState, storedRoute, type XCandidate } from "@/lib/x/judge";
import { xQuestions } from "@/lib/x/questions";
import { reachScore } from "@/lib/x/reach";

/**
 * The X judge. The gates are AnyAPI's measured rubric (xleads/qualify/
 * gates_test.go), generalized; Reddit's lead model never sees a tweet and
 * Reddit's `solves_problem`, which said yes to 6 of 6 curiosity near-misses, is
 * never asked.
 */

const product: ProductFacts = {
  name: "Cal.com",
  pain: "Scheduling back and forth",
  solution: "Open source scheduling",
  targetUsers: "teams",
  geography: null,
  budgetFit: null,
  capabilities: [],
  exclusions: [],
  notBuyers: [],
  destinations: [],
  competitors: ["Calendly"],
  brief: null,
} as unknown as ProductFacts;

const signals = (over: Partial<XSignals> = {}): XSignals => ({
  ownNeed: 0.9,
  sameKind: 0.9,
  rivalVendor: 0.1,
  resolved: 0.1,
  automatedAccount: 0.1,
  offersServices: 0.1,
  curiosity: 0.1,
  promoting: 0.1,
  canUse: 0.9,
  intent: 3,
  founderWouldReply: 0.3,
  replyNeedsProduct: 0.3,
  ...over,
});

describe("X gates, in their fixed order", () => {
  it.each([
    [{ ownNeed: 0.2 }, "search", "reject", "no_active_need"],
    [{ sameKind: 0.3 }, "search", "reject", "wrong_job"],
    [{ rivalVendor: 0.8 }, "search", "reject", "seller_only"],
    [{ resolved: 0.7 }, "search", "reject", "resolved"],
    [{ automatedAccount: 0.9 }, "search", "qualify", "supported_open_need"],
    [{ automatedAccount: 0.9 }, "complete", "reject", "automated_account"],
    [{ offersServices: 0.8 }, "complete", "review", "seller_only"],
    [{ curiosity: 0.8 }, "complete", "review", "asks_about_others"],
    [{ promoting: 0.8 }, "complete", "review", "seller_only"],
    [{ canUse: 0.2 }, "complete", "review", "wrong_audience"],
    [{ intent: 1 }, "complete", "review", "no_active_need"],
    [{ intent: 2 }, "complete", "review", "no_active_need"],
    [{ ownNeed: 0.2, curiosity: 0.9 }, "complete", "reject", "no_active_need"],
    [{}, "complete", "qualify", "supported_open_need"],
  ] as const)("%o at %s is %s (%s)", (over, level, decision, code) => {
    expect(decide(signals(over), level)).toEqual({ decision, code });
  });

  it("holds a reply whose parent X no longer shows", () => {
    expect(decide(signals(), "complete", true)).toEqual({ decision: "review", code: "insufficient_evidence" });
  });

  it("shows nothing before the bio: a search-level pass waits for context", () => {
    expect(stageFor("qualify", "search")).toBe("pending_context");
    expect(stageFor("review", "search")).toBe("pending_context");
    expect(stageFor("reject", "search")).toBe("rejected");
    expect(stageFor("qualify", "complete")).toBe("lead");
  });

  it("sends a turned-away post to the reply check only above the need and kind floors, and never a seller's", () => {
    const worth = { founderWouldReply: 0.7, replyNeedsProduct: 0.2 };
    expect(replyCandidate(signals({ ...worth, intent: 1 }), "no_active_need")).toBe(true);
    expect(replyCandidate(signals({ ...worth, sameKind: 0.4 }), "wrong_job")).toBe(true);
    expect(replyCandidate(signals({ ...worth, curiosity: 0.8 }), "asks_about_others")).toBe(true);
    // No need of their own (188 labelled X posts under 0.3 held no lead), or a different job entirely.
    expect(replyCandidate(signals({ ...worth, ownNeed: 0.4 }), "no_active_need")).toBe(false);
    expect(replyCandidate(signals({ ...worth, sameKind: 0.3 }), "wrong_job")).toBe(false);
    expect(replyCandidate(signals({ ...worth, founderWouldReply: REPLY_FWR - 0.01 }), "no_active_need")).toBe(false);
    expect(replyCandidate(signals({ ...worth, resolved: 0.8 }), "no_active_need")).toBe(false);
    expect(replyCandidate(signals({ ...worth, rivalVendor: 0.8 }), "seller_only")).toBe(false);
    expect(replyCandidate(signals({ ...worth, promoting: 0.8 }), "no_active_need")).toBe(false);
    expect(replyCandidate(signals({ ...worth, canUse: 0.2 }), "no_active_need")).toBe(false);
    expect(replyCandidate(signals(worth), "resolved")).toBe(false);
    expect(replyCandidate(signals({ ...worth, intent: 1, automatedAccount: 0.9 }), "no_active_need")).toBe(false);
    expect(replyCandidate(signals(worth), "automated_account")).toBe(false);
  });

  it("folds fit, intent and engagement into a 0-100 sort order", () => {
    expect(foldScore(4, 4, 4)).toBe(100);
    expect(foldScore(3, 3, 2)).toBe(70);
  });
});

const candidate = (over: Partial<XCandidate> = {}): XCandidate => ({
  tweetId: "1",
  text: "I'm looking for an alternative to Calendly. The only feature I want is round-robin scheduling.",
  rawText: "@someone I'm looking for an alternative to Calendly. The only feature I want is round-robin scheduling.",
  authorUsername: "asker",
  replyingTo: [],
  chainIncomplete: false,
  bio: "freelance designer",
  createdAt: new Date("2026-09-27T10:00:00Z"),
  replyCount: 0,
  ...over,
});

function answersFor(over: Record<string, number | string> = {}): Answers {
  const noul = (key: string, value: number) => [key, { type: "noul", noul: value }] as const;
  const values: Record<string, number> = {
    own_need: 0.9,
    same_kind: 0.9,
    rival_vendor: 0.1,
    resolved: 0.1,
    automated_account: 0.1,
    offers_services: 0.1,
    curiosity: 0.1,
    promoting: 0.1,
    can_use: 0.9,
    founder_would_reply: 0.3,
    reply_needs_product: 0.3,
  };
  const answers: Answers = Object.fromEntries(
    Object.entries(values).map(([key, value]) => noul(key, typeof over[key] === "number" ? (over[key] as number) : value)),
  );
  answers.intent = { type: "score", score: typeof over.intent === "number" ? over.intent : 3 };
  answers.need_quote = { type: "choice", choice: typeof over.need_quote === "string" ? over.need_quote : "s0" };
  answers.wants_offering = { type: "noul", noul: typeof over.wants_offering === "number" ? over.wants_offering : 0.9 };
  answers.hard_requirement = { type: "choice", choice: typeof over.hard_requirement === "string" ? over.hard_requirement : "met" };
  return answers;
}

describe("the X judge's request and verdict", () => {
  it("sends the post's own sentences with no empty title, and withholds popularity", () => {
    const { state, sentences } = candidateState(product, candidate(), "complete");
    expect(sentences.s0).toBe("I'm looking for an alternative to Calendly.");
    expect(Object.values(sentences).every((text) => text.length > 0)).toBe(true);
    const post = (state.posts as { p0: Record<string, unknown> }).p0;
    expect(post.author_bio).toBe("freelance designer");
    for (const key of ["likes", "views", "age_hours", "followers", "upvotes", "comments_on_thread", "subreddit"]) {
      expect(post).not.toHaveProperty(key);
    }
    const searchOnly = (candidateState(product, candidate(), "search").state.posts as { p0: Record<string, unknown> }).p0;
    expect(searchOnly).not.toHaveProperty("author_bio");
  });

  it("asks the X rubric and never Reddit's solves_problem; the bot question only with a bio", () => {
    const search = xQuestions(["s0"], { complete: false, brief: null });
    const complete = xQuestions(["s0"], { complete: true, brief: null });
    expect(search).not.toHaveProperty("solves_problem");
    expect(search).not.toHaveProperty("automated_account");
    expect(complete).toHaveProperty("automated_account");
    for (const key of [
      "own_need",
      "same_kind",
      "rival_vendor",
      "resolved",
      "curiosity",
      "promoting",
      "can_use",
      "intent",
      "need_quote",
      "founder_would_reply",
      "reply_needs_product",
    ]) {
      expect(search).toHaveProperty(key);
    }
    expect(JSON.stringify(search)).not.toMatch(/subreddit/i);
  });

  it("makes a lead of a verbatim ask, and holds one whose quote is not the author's", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const good = assess(answersFor(), candidate(), candidateState(product, candidate(), "complete").sentences, "complete", now);
    expect(good.stage).toBe("lead");
    expect(good.needQuote).toBe("I'm looking for an alternative to Calendly.");
    const noQuote = assess(answersFor({ need_quote: "none" }), candidate(), {}, "complete", now);
    expect(noQuote).toMatchObject({ stage: "review", code: "insufficient_evidence" });
    const forged = assess(answersFor(), candidate(), { s0: "Someone else wants a new CRM." }, "complete", now);
    expect(forged).toMatchObject({ stage: "review", code: "insufficient_evidence" });
  });

  it("holds unsupported product requirements without converting them into conversation cards", () => {
    const sentences = candidateState(product, candidate(), "complete").sentences;
    for (const venue of [false, true]) {
      for (const [requirement, code] of [["unknown", "requirement_unknown"], ["unmet", "requirement_unmet"], ["bad-option", "requirement_unknown"]]) {
        expect(assess(answersFor({ hard_requirement: requirement, founder_would_reply: 0.9 }), candidate({ venue }), sentences, "complete"))
          .toMatchObject({ stage: "review", code });
      }
    }
    const missing = answersFor();
    delete missing.hard_requirement;
    expect(assess(missing, candidate(), sentences, "complete").stage).toBe("review");
    delete missing.wants_offering;
    expect(assess(missing, candidate(), sentences, "complete")).toMatchObject({ stage: "review", code: "insufficient_evidence" });
    expect(assess(answersFor({ wants_offering: 0.2 }), candidate(), sentences, "complete"))
      .toMatchObject({ stage: "review", code: "not_product_seeking" });
    expect(assess(answersFor({ hard_requirement: "none_stated" }), candidate(), sentences, "complete").stage).toBe("lead");
  });

  it("keeps advice-seeking intent out of buyer cards while retaining the checked-reply path", () => {
    const sentences = candidateState(product, candidate(), "complete").sentences;
    expect(assess(answersFor({ intent: 2, founder_would_reply: 0.8 }), candidate(), sentences, "complete"))
      .toMatchObject({ stage: "pending_reply", code: "no_active_need" });
    expect(assess(answersFor({ intent: 2 }), candidate(), sentences, "complete", new Date(), false).stage).toBe("review");
  });

  it("does not let category overlap override the brief's explicit adjacent-job answer", () => {
    const sentences = candidateState(product, candidate(), "complete").sentences;
    const answers = answersFor();
    answers.wanted_kind = { type: "choice", choice: "n0" };
    expect(assess(answers, candidate(), sentences, "complete"))
      .toMatchObject({ stage: "review", code: "wrong_job" });
    answers.wanted_kind = { type: "choice", choice: "this_product" };
    expect(assess(answers, candidate(), sentences, "complete").stage).toBe("lead");
    answers.wanted_kind = { type: "choice", choice: "other" };
    expect(assess(answers, candidate(), sentences, "complete"))
      .toMatchObject({ stage: "review", code: "insufficient_evidence" });
  });

  it("accepts a supported basic job despite narrow positioning, without inferring requirements or relaxing seller checks", () => {
    const raw = answersFor();
    raw.wanted_kind = { type: "choice", choice: "n0" };
    raw.supported_job = { type: "noul", noul: 0.9 };
    const post = candidate();
    const sentences = candidateState(product, post, "complete").sentences;
    expect(assess(raw, post, sentences, "complete").stage).toBe("lead");
    raw.hard_requirement = { type: "choice", choice: "unknown" };
    expect(assess(raw, post, sentences, "complete").code).toBe("requirement_unknown");
    raw.hard_requirement = { type: "choice", choice: "unmet" };
    expect(assess(raw, post, sentences, "complete").code).toBe("requirement_unmet");
    raw.hard_requirement = { type: "choice", choice: "met" };
    raw.rival_vendor = { type: "noul", noul: 0.9 };
    expect(assess(raw, post, sentences, "complete").code).toBe("seller_only");
    raw.rival_vendor = { type: "noul", noul: 0.1 };
    raw.supported_job = { type: "noul", noul: 0.2 };
    expect(assess(raw, post, sentences, "complete").code).toBe("wrong_job");
    raw.supported_job = { type: "noul", noul: 0.9 };
    raw.wanted_kind = { type: "choice", choice: "nothing" };
    expect(assess(raw, post, sentences, "complete").code).toBe("not_product_seeking");
    expect(xQuestions(["s0"], { complete: true, brief: null })).toHaveProperty("supported_job");
  });

  it("recognizes a corroborated author-directed recommendation request without relaxing other gates", () => {
    const ask = candidate({ text: "recommend/pitch me your appointment scheduling tool", rawText: "recommend/pitch me your appointment scheduling tool" });
    const sentences = candidateState(product, ask, "complete").sentences;
    const answers = answersFor({ own_need: 0.32 });
    answers.wanted_kind = { type: "choice", choice: "this_product" };
    expect(assess(answers, ask, sentences, "complete")).toMatchObject({ stage: "lead" });
    expect(assess(answers, ask, sentences, "search")).toMatchObject({ stage: "pending_context" });
    expect(assess(answers, ask, { s0: "recommend me something another author wanted" }, "complete").stage).not.toBe("lead");
    for (const [key, value] of [["resolved", 0.9], ["rival_vendor", 0.9], ["same_kind", 0.2], ["automated_account", 0.9]] as const) {
      const blocked = { ...answers, [key]: { type: "noul" as const, noul: value } };
      expect(assess(blocked, ask, sentences, "complete").stage).not.toBe("lead");
    }
    answers.hard_requirement = { type: "choice", choice: "unknown" };
    expect(assess(answers, ask, sentences, "complete").stage).not.toBe("lead");
    expect(assess(answersFor({ own_need: 0.32 }), candidate({ text: "Drop your startup below" }), { s0: "Drop your startup below" }, "complete").stage).not.toBe("lead");
  });

  it("routes a no-need post Jev thinks worth a reply to the reply check at either level, ranked by the reply answers", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const worth = { same_kind: 0.4, founder_would_reply: 0.8, need_quote: "none" };
    const search = assess(answersFor(worth), candidate(), {}, "search", now);
    expect(search).toMatchObject({ stage: "pending_reply", code: "wrong_job" });
    expect(search.score).toBe(replyScore({ founderWouldReply: 0.8 } as XSignals, search.engagement));
    const complete = assess(answersFor({ ...worth, same_kind: 0.9, intent: 1 }), candidate(), {}, "complete", now);
    expect(complete).toMatchObject({ stage: "pending_reply", code: "no_active_need" });
    // No need of their own, but a post a founder would answer: the venue check reads it (a rival comparison, a price gripe).
    const noNeed = assess(answersFor({ own_need: 0.2, founder_would_reply: 0.9 }), candidate(), {}, "search", now);
    expect(noNeed.stage).toBe("pending_reply");
    expect(noNeed.score).toBe(venueScore({ founderWouldReply: 0.9 } as XSignals, reachScore({ likeCount: null, viewCount: null, createdAt: candidate().createdAt }, now)));
    const notWorth = assess(answersFor({ own_need: 0.2, founder_would_reply: 0.3 }), candidate(), {}, "search", now);
    expect(notWorth.stage).toBe("rejected");
    const seller = assess(answersFor({ ...worth, rival_vendor: 0.9 }), candidate(), {}, "search", now);
    expect(seller.stage).toBe("rejected");
    // A reply whose parent X no longer shows is never a candidate.
    const orphan = assess(answersFor(worth), candidate({ chainIncomplete: true }), {}, "search", now);
    expect(orphan.stage).toBe("rejected");
    // Off, or with no brief to judge against, the buyer path is all there is.
    expect(assess(answersFor(worth), candidate(), {}, "search", now, false).stage).toBe("rejected");
    // A missing reply answer costs the reply check, never the buyer verdict.
    const partial = answersFor();
    delete partial.founder_would_reply;
    expect(assess(partial, candidate(), candidateState(product, candidate(), "complete").sentences, "complete", now).stage).toBe("lead");
  });

  it("sends a venue post nobody is shopping in to the venue check on kind and founder-would-reply alone, ranked by reach", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    // A builder teaching a workflow on a rival's tool: no need of their own, promoting, asking how others do it.
    const teaching = { own_need: 0.1, same_kind: 0.7, promoting: 0.9, curiosity: 0.9, can_use: 0.2, founder_would_reply: 0.8, need_quote: "none" };
    const popular = candidate({ venue: true, likeCount: 400, viewCount: 50_000, createdAt: new Date(now.getTime() - 2 * 3_600_000) });
    const venue = assess(answersFor(teaching), popular, {}, "search", now);
    expect(venue.stage).toBe("pending_reply");
    expect(venue.score).toBe(venueScore({ founderWouldReply: 0.8 } as XSignals, reachScore({ likeCount: 400, viewCount: 50_000, createdAt: popular.createdAt }, now)));
    // The same answers from a rival lane fail the need check's floors, so the venue check reads it too.
    expect(assess(answersFor(teaching), candidate(), {}, "search", now).stage).toBe("pending_reply");
    expect(replyRoute(signals({ ownNeed: 0.1, sameKind: 0.7, promoting: 0.9, founderWouldReply: 0.8 }), "no_active_need", "reject", false)).toBe("venue");
    expect(replyRoute(signals({ ownNeed: 0.1, sameKind: 0.2, founderWouldReply: 0.8 }), "no_active_need", "reject", false)).toBeNull();
    // A post the gates held stays in Held for a look: only a settled reject goes to the venue check.
    expect(replyRoute(signals({ ownNeed: 0.9, sameKind: 0.9, promoting: 0.9, founderWouldReply: 0.8 }), "seller_only", "review", false)).toBeNull();
    // A freelancer pitching, another kind of product, or a founder who would not reply, never.
    expect(venueCandidate(signals({ ownNeed: 0.1, sameKind: 0.7, offersServices: 0.8, founderWouldReply: 0.8 }))).toBe(false);
    expect(venueCandidate(signals({ ownNeed: 0.1, sameKind: 0.2, founderWouldReply: 0.8 }))).toBe(false);
    expect(venueCandidate(signals({ ownNeed: 0.1, sameKind: 0.7, founderWouldReply: 0.3 }))).toBe(false);
    // The measured floors: a founder's real targets sat at 0.40-0.49 would-reply and 0.3 same kind.
    expect(venueCandidate(signals({ ownNeed: 0.1, sameKind: 0.33, founderWouldReply: 0.44 }))).toBe(true);
    expect(venueCandidate(signals({ ownNeed: 0.1, sameKind: 0.7, founderWouldReply: 0.8, automatedAccount: 0.9 }))).toBe(false);
    // A fresh, widely read post outranks a stale, quiet one with the same answers.
    const quiet = candidate({ venue: true, likeCount: 2, viewCount: 90, createdAt: new Date(now.getTime() - 30 * 3_600_000) });
    expect(assess(answersFor(teaching), quiet, {}, "search", now).score).toBeLessThan(venue.score);
  });

  it("sends a stored candidate to the check assess routed it to, and to the need check when its answers cannot be read", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const cases: Array<[Record<string, number | string>, "search" | "complete"]> = [
      [{ same_kind: 0.4, founder_would_reply: 0.8, need_quote: "none" }, "search"],
      [{ own_need: 0.2, founder_would_reply: 0.9 }, "search"],
      [{ own_need: 0.1, same_kind: 0.7, promoting: 0.9, founder_would_reply: 0.8, need_quote: "none" }, "complete"],
      [{ same_kind: 0.9, intent: 1, founder_would_reply: 0.8, need_quote: "none" }, "complete"],
    ];
    for (const [over, level] of cases) {
      const answers = answersFor(over);
      const verdict = assess(answers, candidate(), {}, level, now);
      expect(verdict.stage).toBe("pending_reply");
      const venue = verdict.score === venueScore(signals({ founderWouldReply: Number(over.founder_would_reply) }), reachScore({ likeCount: null, viewCount: null, createdAt: candidate().createdAt }, now));
      expect(storedRoute(answers, level, verdict.code, verdict.decision, false)).toBe(venue ? "venue" : "need");
    }
    expect(storedRoute({}, "search", "no_active_need", "reject", false)).toBe("need");
    expect(storedRoute({}, "search", "no_active_need", "reject", true)).toBe("venue");
  });

  it("leaves a rival-lane post the gates held in Held, whatever a founder would reply", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const held = assess(answersFor({ can_use: 0.2, founder_would_reply: 0.9 }), candidate(), {}, "complete", now);
    expect(held).toMatchObject({ stage: "review", code: "wrong_audience" });
  });

  it("throws on a missing answer, which the batch reads as unanswered, never as a reject", () => {
    const answers = answersFor();
    delete answers.curiosity;
    expect(() => assess(answers, candidate(), { s0: "x" }, "complete")).toThrow();
  });
});
