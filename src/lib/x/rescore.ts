import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { xEvaluations, xPosts } from "@/db/schema";
import { inFlight } from "@/lib/inFlight";
import type { ProductFacts } from "@/lib/product";
import { X_SCORER_VERSION } from "./constants";
import { candidateOf, judgeX } from "./judge";
import { updateEvaluation } from "./write";

/**
 * Scores the posts the free screen set aside, so the Filtered out list can
 * rank them like everything else instead of by the rule's reputation alone:
 * on 2026-09-28's first looks of 14 products, 599 of 949 left-out posts were
 * screened and so never scored. One Jev read each at the search level, the
 * cheapest the judge has (about $0.0001 a post), with no bio and no reply
 * check, recorded as x_rescore: it spends X's model budget, never the day's
 * judged allowance the scan's candidates wait on. The post stays screened:
 * its stage, rule and every gate are untouched, and only its fit, intent,
 * score, reason and raw answers are kept for the list's order and bar. Never
 * a lead, never an alert.
 */

/** Rules whose posts a score would not help anyone judge: out of the window, another language, a bare link, the product's or a rival's own account, Grok. */
const UNSCORED_RULES = ["stale", "other_language", "bare_link", "own_or_rival_account", "machine_query"];
/** The most screened posts one run scores, newest first; the rest wait for the next run. */
export const SCREENED_SCORES_PER_RUN = 150;
const CONCURRENCY = 8;

/** Scores up to `limit` unscored screened posts, newest first. Returns how many it scored. */
export async function scoreScreened(projectId: string, product: ProductFacts, limit = SCREENED_SCORES_PER_RUN): Promise<number> {
  const rows = await db()
    .select({ evaluation: xEvaluations, post: xPosts })
    .from(xEvaluations)
    .innerJoin(xPosts, eq(xPosts.id, xEvaluations.tweetId))
    .where(
      and(
        eq(xEvaluations.projectId, projectId),
        eq(xEvaluations.stage, "free_rejected"),
        isNull(xEvaluations.score),
        isNull(xPosts.unavailableAt),
        notInArray(sql`split_part(${xEvaluations.freeReject}, ':', 1)`, UNSCORED_RULES),
      ),
    )
    .orderBy(desc(xPosts.createdAt))
    .limit(limit);
  let scored = 0;
  await inFlight(
    rows,
    async ({ evaluation, post }) => {
      const context = evaluation.context as { text?: string; replyingTo?: string[] } | null;
      // Read as a whole chain: the chain-incomplete gate decides leads, and
      // this read only orders the list, so its reason keeps saying what the
      // post wants rather than that X no longer shows the post it answers.
      const candidate = { ...candidateOf(post, context, null, false), chainIncomplete: false };
      const assessment = await judgeX(projectId, product, candidate, "search", false, "x_rescore");
      if (!assessment) return;
      await updateEvaluation(evaluation.id, {
        fit: assessment.fit,
        intent: assessment.intent,
        engagement: assessment.engagement,
        score: assessment.score,
        reason: assessment.reason,
        signals: assessment.signals,
        scorerVersion: X_SCORER_VERSION,
      });
      scored += 1;
    },
    CONCURRENCY,
  );
  return scored;
}
