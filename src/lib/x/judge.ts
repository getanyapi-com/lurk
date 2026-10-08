import { askJev, choice, noul, score, type Answers } from "@/lib/jev";
import { LlmCapReachedError } from "@/lib/llm";
import type { ProductFacts } from "@/lib/product";
import { productState } from "@/lib/product";
import { engagementScore } from "@/lib/scan/constants";
import { plainTypography, truncateBody } from "@/lib/scan/evidence";
import { NO_QUOTE } from "@/lib/scan/questions";
import { spans } from "@/lib/scan/spans";
import { isVerbatim } from "@/lib/scan/validate";
import { assertXLlmUnderCap } from "./budget";
import { BIO_CHARS, BODY_CHARS, type XPurpose } from "./constants";
import {
  decide,
  buyerEvidenceGate,
  isDirectRequest,
  fitFrom,
  replyRoute,
  replyScore,
  venueScore,
  foldScore,
  reasonFrom,
  stageFor,
  type XDecision,
  type XReplyRoute,
  type XLevel,
  type XReasonCode,
  type XSignals,
  type XStage,
} from "./gates";
import { ownWords } from "./map";
import { xQuestions } from "./questions";
import { reachScore } from "./reach";
import type { StoredXPost } from "./store";

/**
 * One X post judged against one product, one post per request, as Reddit's
 * judge does (one at a time scored 0.843 AUC against 0.828 at ten, and xleads
 * found ten posts sharing one state moved each other's answers). The judge
 * sees the post's own words cut into sentences it can point at, the posts it
 * answers as context, and at the complete level the author's bio. Likes,
 * views, age and follower counts are withheld, as xleads does: popularity is
 * not intent.
 */

export type XCandidate = {
  tweetId: string;
  /** The post's own words: the leading @handles removed, a self-thread joined above. */
  text: string;
  /** The text as X returned it, which a quote may also be checked against. */
  rawText: string;
  authorUsername: string;
  /** The nearest posts by other people it answers, as `@handle: text`. */
  replyingTo: string[];
  chainIncomplete: boolean;
  bio: string | null;
  createdAt: Date;
  replyCount: number | null;
  likeCount?: number | null;
  viewCount?: number | null;
  /** When X gave the counts above. */
  fetchedAt?: Date | null;
  /**
   * Found by a venue lane (build-vs-buy, workflow), or a rival lane's post
   * routed as one (gates.ts replyRoute): when the buyer gates turn it away it
   * is checked as a place worth replying, not as a need.
   */
  venue?: boolean;
};

/**
 * A stored post as the judge reads it: its own words, or the self-thread its
 * context walk joined above them, and the posts that walk found it answering.
 */
export function candidateOf(
  post: StoredXPost,
  context: { text?: string; replyingTo?: string[]; chainIncomplete?: boolean } | null,
  bio: string | null,
  venue: boolean,
): XCandidate {
  return {
    tweetId: post.id,
    text: context?.text ?? ownWords(post),
    rawText: post.text,
    authorUsername: post.authorUsername,
    replyingTo: context?.replyingTo ?? [],
    chainIncomplete: context?.chainIncomplete ?? false,
    bio,
    createdAt: post.createdAt,
    replyCount: post.replyCount,
    likeCount: post.likeCount,
    viewCount: post.viewCount,
    fetchedAt: post.fetchedAt,
    venue,
  };
}

export type XAssessment = {
  level: XLevel;
  decision: XDecision;
  code: XReasonCode;
  stage: XStage;
  reason: string;
  fit: number;
  intent: number;
  engagement: number;
  score: number;
  needQuote: string | null;
  /** Every raw answer, kept so the gates can be replayed and an X model fitted later. */
  signals: Answers;
};

export function candidateState(product: ProductFacts, candidate: XCandidate, level: XLevel) {
  const sentences = spans(null, truncateBody(plainTypography(candidate.text), BODY_CHARS));
  const post: Record<string, unknown> = {
    text: truncateBody(plainTypography(candidate.text), BODY_CHARS),
    author: `@${candidate.authorUsername}`,
    sentences,
  };
  if (candidate.replyingTo.length > 0) {
    post.replying_to = candidate.replyingTo;
  }
  if (level === "complete" && candidate.bio) {
    post.author_bio = candidate.bio.slice(0, BIO_CHARS);
  }
  return { state: { product: productState(product), posts: { p0: post } }, sentences };
}

function lenient(answers: Answers, key: string): number {
  const answer = answers[key];
  return answer?.type === "noul" ? answer.noul : 0;
}

/** The typed answers the gates read. Throws when one is missing, which the batch treats as unanswered. */
export function signalsFrom(answers: Answers, level: XLevel): XSignals {
  return {
    ownNeed: noul(answers, "own_need"),
    sameKind: noul(answers, "same_kind"),
    rivalVendor: noul(answers, "rival_vendor"),
    resolved: noul(answers, "resolved"),
    automatedAccount: level === "complete" ? noul(answers, "automated_account") : null,
    offersServices: noul(answers, "offers_services"),
    curiosity: noul(answers, "curiosity"),
    promoting: noul(answers, "promoting"),
    canUse: noul(answers, "can_use"),
    intent: Math.min(4, Math.max(0, Math.round(score(answers, "intent").score))),
    // Read leniently: a missing reply answer must not make the whole post
    // unanswered and cost the buyer path an attempt.
    founderWouldReply: lenient(answers, "founder_would_reply"),
    replyNeedsProduct: lenient(answers, "reply_needs_product"),
  };
}

/** Turns one post's answers into its verdict, with the quote checked against the author's own words. */
export function assess(
  answers: Answers,
  candidate: XCandidate,
  sentences: Record<string, string>,
  level: XLevel,
  now = new Date(),
  replies = true,
): XAssessment {
  const signals = signalsFrom(answers, level);
  const picked = choice(answers, "need_quote").choice;
  const needQuote = picked === NO_QUOTE ? null : (sentences[picked] ?? null);
  const offering = answers.wants_offering;
  const requirement = answers.hard_requirement;
  const wantedKind = answers.wanted_kind;
  const held = buyerEvidenceGate({
    wantsOffering: offering?.type === "noul" ? offering.noul : null,
    requirement: requirement?.type === "choice" ? requirement.choice : null,
    ...(wantedKind ? { wantedKind: wantedKind.type === "choice" ? wantedKind.choice : null } : {}),
  });
  const verbatim = Boolean(needQuote && isVerbatim(needQuote, [candidate.text, candidate.rawText].map(plainTypography)));
  // A literal "recommend me/us" request with corroborated product fit is
  // stronger own-need evidence than an inconsistent probability. Preserve
  // the raw score; every other gate, parent/bio check and budget still applies.
  const directRequestEvidence = verbatim && needQuote !== null && isDirectRequest(needQuote) && !held &&
    wantedKind?.type === "choice" && wantedKind.choice === "this_product" && signals.intent >= 3;
  let { decision, code } = decide(signals, level, candidate.chainIncomplete, directRequestEvidence);
  if (decision === "qualify" && held) ({ decision, code } = held);
  if (decision === "qualify" && !verbatim) {
    decision = "review";
    code = "insufficient_evidence";
  }
  const fit = fitFrom(signals.ownNeed, signals.sameKind);
  const ageHours = (now.getTime() - candidate.createdAt.getTime()) / 3_600_000;
  const engagement = engagementScore(ageHours, candidate.replyCount);
  let stage = stageFor(decision, level);
  // A post the buyer gates turn away may still be worth a reply; a stronger
  // model reads it with the author's bio before anything is shown.
  const turnedAway = stage === "rejected" || stage === "review";
  const route =
    replies && !candidate.chainIncomplete && turnedAway &&
    !["requirement_unknown", "requirement_unmet", "not_product_seeking", "insufficient_evidence"].includes(code)
      ? replyRoute(signals, code, decision, Boolean(candidate.venue)) : null;
  if (route) {
    stage = "pending_reply";
  }
  const reach = reachScore(
    {
      likeCount: candidate.likeCount ?? null,
      viewCount: candidate.viewCount ?? null,
      createdAt: candidate.createdAt,
      fetchedAt: candidate.fetchedAt ?? null,
    },
    now,
  );
  return {
    level,
    decision,
    code,
    stage,
    reason: reasonFrom(code, signals, candidate.chainIncomplete),
    fit,
    intent: signals.intent,
    engagement,
    score:
      route === "venue"
        ? venueScore(signals, reach)
        : route === "need"
          ? replyScore(signals, engagement)
          : foldScore(fit, signals.intent, engagement),
    needQuote,
    signals: answers,
  };
}

/**
 * The reply check a stored candidate goes to, from its stored answers and
 * reason: what assess decided when it routed the post. A candidate whose
 * answers cannot be read goes to the need check, as it always did.
 */
export function storedRoute(
  answers: unknown,
  level: string | null,
  code: string | null,
  decision: string | null,
  venueLane: boolean,
): XReplyRoute {
  if (venueLane) return "venue";
  try {
    const signals = signalsFrom(answers as Answers, level === "complete" ? "complete" : "search");
    return replyRoute(signals, (code ?? "no_active_need") as XReasonCode, (decision ?? "reject") as XDecision, false) ?? "need";
  } catch {
    return "need";
  }
}

/**
 * Judges one candidate, or null when the model never answered: an unanswered
 * post keeps no verdict and is asked again later, never rejected. A spent
 * budget, global or X's own, is thrown, and the run ends partial. The call is
 * recorded under `purpose`, which the day's judged allowance counts by
 * (run.ts poolsFor): x_score and x_final by default.
 */
export async function judgeX(
  projectId: string,
  product: ProductFacts,
  candidate: XCandidate,
  level: XLevel,
  replies = true,
  purpose: XPurpose = level === "complete" ? "x_final" : "x_score",
): Promise<XAssessment | null> {
  const { state, sentences } = candidateState(product, candidate, level);
  const questions = xQuestions(Object.keys(sentences), {
    complete: level === "complete",
    brief: product.brief,
  });
  try {
    await assertXLlmUnderCap();
    const answers = await askJev({ purpose, projectId, state, questions });
    return assess(answers, candidate, sentences, level, new Date(), replies);
  } catch (error) {
    if (error instanceof LlmCapReachedError) {
      throw error;
    }
    // A dropped call, a refused request or an answer missing a question the
    // gates read: unanswered, never rejected.
    return null;
  }
}
