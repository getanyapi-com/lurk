import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { xEvaluations, xPosts } from "@/db/schema";
import type { ProductFacts } from "@/lib/product";
import { X_SCORER_VERSION } from "./constants";
import { judgeX } from "./judge";
import { ownWords } from "./map";
import { updateEvaluation } from "./write";

/**
 * Scores the posts the free screen set aside, so the Filtered out list can
 * rank them like everything else instead of by the rule's reputation alone:
 * on 2026-09-28's first looks of 14 products, 599 of 949 left-out posts were
 * screened and so never scored. One Jev read each at the search level, the
 * cheapest the judge has (about $0.0001 a post), with no bio and no reply
 * check. The post stays screened: its stage, rule and every gate are
 * untouched, and only its fit, intent, score, reason and raw answers are kept
 * for the list's order and bar. Never a lead, never an alert.
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
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const { evaluation, post } = rows[next];
      next += 1;
      const context = evaluation.context as { text?: string; replyingTo?: string[] } | null;
      const assessment = await judgeX(
        projectId,
        product,
        {
          tweetId: post.id,
          text: context?.text ?? ownWords(post),
          rawText: post.text,
          authorUsername: post.authorUsername,
          replyingTo: context?.replyingTo ?? [],
          chainIncomplete: false,
          bio: null,
          createdAt: post.createdAt,
          replyCount: post.replyCount,
          likeCount: post.likeCount,
          viewCount: post.viewCount,
          fetchedAt: post.fetchedAt,
        },
        "search",
        false,
      );
      if (!assessment) continue;
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
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return scored;
}
