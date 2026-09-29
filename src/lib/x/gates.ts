import { INTENT_LEVELS } from "@/lib/scan/questions";

/**
 * The X qualification gates, ported from AnyAPI's measured rubric
 * (xleads/qualify/gates.go). They are non-compensatory and live in code,
 * because a model asked for one number lets a strong intent pay for a missing
 * fit. Each reads one noul against the midpoint, in a fixed order. Reddit's
 * fitted lead model is never applied to a tweet: it was fitted on 2,362 Reddit
 * posts, and until X labels exist hand gates are the honest choice.
 *
 * A reject needs one settled disqualifier. A post that passes those but asks
 * about someone else's build, sells or promotes, or is not yet looking to act,
 * is held for a look. Everything else qualifies.
 */

const YES = 0.5;

export type XLevel = "search" | "complete";

export type XSignals = {
  ownNeed: number;
  sameKind: number;
  rivalVendor: number;
  resolved: number;
  /** Asked only at the complete level, once the bio is known. */
  automatedAccount: number | null;
  offersServices: number;
  curiosity: number;
  promoting: number;
  canUse: number;
  /** 0-4. */
  intent: number;
  /** Would the product's maker be glad to reply and suggest it: the reply-worthiness screen. */
  founderWouldReply: number;
  /** Would the most helpful reply need the product at all. */
  replyNeedsProduct: number;
};

export type XDecision = "qualify" | "review" | "reject";

export type XReasonCode =
  | "supported_open_need"
  | "no_active_need"
  | "wrong_job"
  | "seller_only"
  | "resolved"
  | "automated_account"
  | "asks_about_others"
  | "wrong_audience"
  | "insufficient_evidence"
  | "worth_reply";

export type XStage = "rejected" | "pending_context" | "pending_reply" | "lead" | "review";

/**
 * The buyer verdicts a post worth a reply can come from: a need of their own
 * but not yet looking to act, a need the judge read as a neighbouring job, or
 * asking about someone else's setup while stating their own need. A seller, a
 * bot, a settled need, the wrong audience or a quote that is not theirs is
 * never worth a reply.
 */
const REPLY_CODES = new Set<XReasonCode>(["no_active_need", "wrong_job", "asks_about_others"]);

/**
 * The Jev floors a post must clear before Muse is paid to check it is worth a
 * reply. Muse is the precision stage, so these keep recall and drop only where
 * the noise measurably is:
 * - own_need: of AnyAPI's 271 labelled X posts, 188 scored under 0.3 and none
 *   was a lead; 0.3-0.5 held 3 of 29. Under 0.5 waits for X labels.
 * - same_kind: under 0.35, 84% of Reddit's labelled threads were noise ("the
 *   product wouldn't fix this case", the biggest noise class).
 * - founder_would_reply at 0.5 keeps 84% of the worth-a-comment threads inside
 *   those floors; candidates are then checked best first by it (the top 20 were
 *   70% worth). reply_needs_product ranks nothing better and is only stored.
 */
export const REPLY_OWN_NEED = 0.5;
export const REPLY_SAME_KIND = 0.35;
export const REPLY_FWR = 0.5;

/**
 * The Jev floors for a post from a venue lane (build-vs-buy, workflow) before
 * Muse is paid to check it is worth a reply. Nobody in such a post needs to be
 * shopping, so own_need, can_use, curiosity and promoting do not apply: 24 of
 * the 26 posts one founder chose to reply on would have failed them (a builder
 * teaching a workflow on a rival's tool "promotes"; "where are you getting the
 * data" posts ask about someone else's build). What still does: the post is
 * about this kind of product, its author is not a freelancer pitching or a
 * bot, and a founder would be glad to reply.
 *
 * Measured on 2026-09-28 (.context/x-general/venue-eval) against AnyAPI's
 * product: the founder's 26 real plug targets and 30 of its probe posts
 * labelled noise. At founder_would_reply 0.5 and same_kind 0.35 the floor let
 * 10 of 26 targets through, failing the pre-registered 20; the targets it
 * missed sat at 0.40-0.49 while no noise post scored above 0.41. At 0.4 and
 * 0.3 it lets 16 through and 1 noise post, and the venue check after it shows
 * 13 of 26 targets and 0 of 30 noise. Those floors were chosen on the same
 * posts, so the pilot's labelled week is the out-of-sample check. About 9 of
 * the 26 are open calls or off-topic posts no venue lane would find.
 */
export const VENUE_SAME_KIND = 0.3;
export const VENUE_FWR = 0.4;

export function venueCandidate(signals: XSignals): boolean {
  return (
    signals.sameKind >= VENUE_SAME_KIND &&
    signals.offersServices < YES &&
    (signals.automatedAccount ?? 0) < YES &&
    signals.founderWouldReply >= VENUE_FWR
  );
}

/** Whether a post the buyer gates turned away should be checked for being worth a reply. */
export function replyCandidate(signals: XSignals, code: XReasonCode): boolean {
  return (
    REPLY_CODES.has(code) &&
    signals.ownNeed >= REPLY_OWN_NEED &&
    signals.sameKind >= REPLY_SAME_KIND &&
    signals.resolved < YES &&
    signals.rivalVendor < YES &&
    signals.promoting < YES &&
    signals.offersServices < YES &&
    signals.canUse >= YES &&
    (signals.automatedAccount ?? 0) < YES &&
    (signals.curiosity < YES || signals.ownNeed >= YES) &&
    signals.founderWouldReply >= REPLY_FWR
  );
}

/**
 * Which reply check a post the buyer gates turned away goes to, if any. A
 * venue lane's post is only ever a venue. A rival lane's post is first read as
 * someone with the problem; when the gates reject it outright it may still be a venue:
 * a comparison or a price gripe about a rival, in front of buyers, with nobody
 * asking. Of 30 people with the problem now in the 2026-09-28 week, v3 showed
 * 3; three rival-lane comparisons and price gripes the venue check would have
 * shown were turned away here (.context/x-useful/seat.md).
 */
export type XReplyRoute = "need" | "venue";

export function replyRoute(signals: XSignals, code: XReasonCode, decision: XDecision, venueLane: boolean): XReplyRoute | null {
  if (venueLane) return venueCandidate(signals) ? "venue" : null;
  if (replyCandidate(signals, code)) return "need";
  // Only a settled reject: a post the gates held stays in Held for a look. A
  // rival lane finds rivals' own posts too, and those are never a venue.
  return decision === "reject" && signals.rivalVendor < YES && venueCandidate(signals) ? "venue" : null;
}

export function decide(
  signals: XSignals,
  level: XLevel,
  chainIncomplete = false,
): { decision: XDecision; code: XReasonCode } {
  if (signals.ownNeed < YES) return { decision: "reject", code: "no_active_need" };
  if (signals.sameKind < YES) return { decision: "reject", code: "wrong_job" };
  if (signals.rivalVendor >= YES) return { decision: "reject", code: "seller_only" };
  if (signals.resolved >= YES) return { decision: "reject", code: "resolved" };
  if (level === "complete" && (signals.automatedAccount ?? 0) >= YES) {
    return { decision: "reject", code: "automated_account" };
  }
  if (signals.offersServices >= YES) return { decision: "review", code: "seller_only" };
  if (signals.curiosity >= YES) return { decision: "review", code: "asks_about_others" };
  if (signals.promoting >= YES) return { decision: "review", code: "seller_only" };
  if (signals.canUse < YES) return { decision: "review", code: "wrong_audience" };
  if (signals.intent < 2) return { decision: "review", code: "no_active_need" };
  if (chainIncomplete) return { decision: "review", code: "insufficient_evidence" };
  return { decision: "qualify", code: "supported_open_need" };
}

/**
 * The stage the pipeline stores. At the search level nothing is shown yet,
 * because the bio is bought before anything is: a qualify and a review both
 * wait for context, and only a settled disqualifier rejects.
 */
export function stageFor(decision: XDecision, level: XLevel): XStage {
  if (level !== "complete") {
    return decision === "reject" ? "rejected" : "pending_context";
  }
  return decision === "qualify" ? "lead" : decision === "review" ? "review" : "rejected";
}

export function priorityFor(decision: XDecision, intent: number): "p0" | "p1" | null {
  if (decision !== "qualify") return null;
  if (intent >= 3) return "p0";
  if (intent === 2) return "p1";
  return null;
}

function clampLevel(level: number): number {
  return Math.min(4, Math.max(0, Math.round(level)));
}

/** "A need of their own, for this kind of product", own_need × same_kind on the 0-4 fit scale. It ranks; it decides nothing. */
export function fitFrom(ownNeed: number, sameKind: number): number {
  return clampLevel(4 * ownNeed * sameKind);
}

/** The tab's sort order, 0-100: fit and intent at twice the weight of engagement. */
export function foldScore(fit: number, intent: number, engagement: number): number {
  return Math.round(((clampLevel(fit) * 2 + clampLevel(intent) * 2 + engagement) / 20) * 100);
}

/** A reply's sort order, 0-100, compared only with other replies: founder_would_reply, then freshness and room. */
export function replyScore(signals: XSignals, engagement: number): number {
  return Math.round(50 * signals.founderWouldReply + 12.5 * Math.min(4, Math.max(0, engagement)));
}

/** A venue post's sort order, 0-100, compared with other replies: founder_would_reply, then reach and freshness (reach.ts). */
export function venueScore(signals: XSignals, reach: number): number {
  return Math.round(40 * signals.founderWouldReply + 0.6 * Math.min(100, Math.max(0, reach)));
}

function percent(noul: number | null): string {
  return `${Math.round((noul ?? 0) * 100)}% yes`;
}

/** The sentence a card shows: the answer that decided, in plain words. */
export function reasonFrom(code: XReasonCode, signals: XSignals, chainIncomplete = false): string {
  switch (code) {
    case "no_active_need":
      return signals.ownNeed < YES
        ? `States no need of their own (${percent(signals.ownNeed)}).`
        : `Has a need but is not looking to act on it yet. ${INTENT_LEVELS[clampLevel(signals.intent)]}.`;
    case "wrong_job":
      return `Wants a different kind of thing than this product (${percent(signals.sameKind)} same kind).`;
    case "seller_only":
      if (signals.rivalVendor >= YES) return `Sells this kind of product (${percent(signals.rivalVendor)}).`;
      if (signals.offersServices >= YES) return `Offers their services or is hiring (${percent(signals.offersServices)}).`;
      return `Promoting their own product, service or method (${percent(signals.promoting)}).`;
    case "resolved":
      return `Already has a setup they are happy with (${percent(signals.resolved)}).`;
    case "automated_account":
      return `Looks like an automated account (${percent(signals.automatedAccount)}).`;
    case "asks_about_others":
      return `Asks how someone else built or chose their thing (${percent(signals.curiosity)}).`;
    case "wrong_audience":
      return `Probably outside who or where the product serves (${percent(signals.canUse)} could buy).`;
    case "worth_reply":
      return "Worth a reply: talking about the problem your product solves, not shopping yet.";
    case "insufficient_evidence":
      return chainIncomplete
        ? "Replies to a post X no longer shows, so what they ask for can't be read in full."
        : "Asks for what this product does, but no sentence of theirs says so on its own.";
    default:
      return `Wants what this product does, in their own words. ${INTENT_LEVELS[clampLevel(signals.intent)]}.`;
  }
}
