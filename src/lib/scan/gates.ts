import { engagementScore, foldScore } from "./constants";
import type { Assessment, Decision, Judgement, ReasonCode, ScorableItem } from "./judgement";

/**
 * The qualification gates. They are non-compensatory and they live here, in
 * code, because a model asked for one number will always let a strong intent
 * pay for a missing fit. A lead qualifies only when the person is a buyer with
 * a need still open, the product plausibly does the job, and they are looking
 * for one.
 */

/**
 * The first gate this assessment fails, as the reason code that names it, or
 * null when it passes every gate. The code says which gate; whether that gate
 * rejects or holds is `settledDisqualifier` below, so the two questions cannot
 * drift apart.
 */
export function gateFailure(item: Assessment): ReasonCode | null {
  if (item.relationship === "seller") {
    return "seller_only";
  }
  if (item.relationship === "helper") {
    return "helper_only";
  }
  if (item.needState === "resolved") {
    return "resolved";
  }
  if (item.needState === "no_active_need" || item.relationship === "discussion") {
    return "no_active_need";
  }
  if (item.fit === 0) {
    return "wrong_job";
  }
  if (item.fit === 1) {
    return "wrong_audience";
  }
  if (item.relationship !== "buyer" || item.needState === "unknown") {
    return "insufficient_evidence";
  }
  if (item.fit === null || item.fit === 2) {
    return "insufficient_evidence";
  }
  if (item.intent === null) {
    return "insufficient_evidence";
  }
  if (item.intent < 2) {
    return "no_active_need";
  }
  return null;
}

/**
 * True when the model could not say anything at all about this person: not who
 * they are, not whether they need something, not whether the product does the
 * job. Review is for a plausible buyer with a material unknown, so an item with
 * no reading behind it is a rejection and never something to put in front of a
 * person. A buyer, an open or evaluating need, or any fit at all is a reading.
 */
function nothingAssessed(item: Assessment): boolean {
  return item.relationship === "unknown" && item.needState === "unknown" && item.fit === null;
}

/**
 * The rejection invariant: a reject rests on one settled disqualifier, and on
 * nothing else. Those are a person who sells or is helping somebody else, a
 * need that is met or was never there, a job the product plainly does not do
 * (fit 0), and an item nothing at all could be read into.
 *
 * Everything else that is not a qualify is a review, which is a pile a person
 * can settle in a glance. That includes the model rejecting on its own reading
 * with none of these behind it, and fit 1: category overlap with no supported
 * solution is a thin reading of the product, not a fact about the person.
 */
function settledDisqualifier(item: Assessment): boolean {
  return (
    item.relationship === "seller" ||
    item.relationship === "helper" ||
    item.needState === "resolved" ||
    item.needState === "no_active_need" ||
    item.fit === 0 ||
    nothingAssessed(item)
  );
}

/**
 * The decision the scan acts on. The model may send an item to review on its
 * own reading; only the gates may let something qualify, and only a settled
 * disqualifier may reject.
 */
export function decide(item: Assessment): { decision: Decision; reasonCode: ReasonCode } {
  const failure = gateFailure(item);
  if (!failure) {
    return {
      decision: item.decision === "reject" ? "review" : item.decision,
      reasonCode: item.reasonCode,
    };
  }
  return { decision: settledDisqualifier(item) ? "reject" : "review", reasonCode: failure };
}

/** What a lead is for. A `context` lead is a thread worth a comment, not an ask. */
export type LeadKind = "buyer" | "context";

/** The gate failures that are still a thread worth commenting in. */
const CONTEXT_FAILURES: ReasonCode[] = ["helper_only", "no_active_need"];

/**
 * Where this assessment belongs, or null when it belongs nowhere. A buyer with
 * an open need the product covers is the feed's own lead. Someone helping
 * another person and a thread where nobody asks are not buyers, but when the
 * product plainly does the job they are talking about (fit 3, not the fit 2 a
 * missing fact leaves) a comment there is worth writing. Someone promoting
 * their own thing is not: on the posts labelled 2026-09-19 those threads were
 * a rival's launch, and a reply there is an advert under an advert. A settled
 * need and a job the product does not do stay rejections too.
 */
export function routeLead(item: Assessment): LeadKind | null {
  const failure = gateFailure(item);
  if (decide(item).decision === "qualify") {
    return "buyer";
  }
  if (failure && CONTEXT_FAILURES.includes(failure) && item.fit !== null && item.fit >= 3) {
    return "context";
  }
  return null;
}

/**
 * Sends an item the evidence does not support to review, never to the feed. A
 * settled rejection is left alone: it does not rest on the quote, and its own
 * code says more than this one would.
 */
export function downgradeToReview(item: Judgement, code: ReasonCode): Judgement {
  return item.decision === "reject" ? item : { ...item, decision: "review", reasonCode: code };
}

/**
 * One assessment as the scan uses it: the gated decision, the engagement this
 * code computed, the feed sort order, and the two columns the leads table has
 * always held.
 */
export function judge(item: Assessment, source: ScorableItem): Judgement {
  const engagement = engagementScore(source.ageHours, source.numComments);
  const { decision, reasonCode } = decide(item);
  return {
    ...item,
    decision,
    reasonCode,
    engagement,
    score: foldScore(item.fit, item.intent, engagement),
    matchedPhrase: item.needEvidence?.quote ?? "",
    sellerSide: item.relationship === "seller",
  };
}
