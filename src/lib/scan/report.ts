import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { leadEvaluations, redditComments, redditPosts } from "@/db/schema";
import { newerThan } from "@/lib/leads";

import type { FeedWindow } from "@/lib/feed";

/**
 * What one window of scanning actually did, so an empty feed can say why. Every
 * number here counts verdicts the scan already stored. Nothing is estimated.
 */
export type ScanReport = {
  /** Candidates that got a verdict: qualified plus held plus rejected. */
  read: number;
  qualified: number;
  held: number;
  rejected: number;
};

/**
 * The verdict counts for one project and one feed window, read on the same
 * basis as the feed below it: when the person posted, not when we judged them.
 * A backfill judges an old thread today, so windowing on judged_at counted
 * hundreds of posts the feed was never going to show. A comment verdict is as
 * old as the comment, which is why the comments join is here.
 */
export async function scanReport(projectId: string, days: FeedWindow): Promise<ScanReport> {
  const verdicts = await db()
    .select({ decision: leadEvaluations.decision, total: count() })
    .from(leadEvaluations)
    .innerJoin(redditPosts, eq(redditPosts.id, leadEvaluations.postId))
    .leftJoin(redditComments, eq(redditComments.id, leadEvaluations.commentId))
    .where(and(eq(leadEvaluations.projectId, projectId), newerThan(days)))
    .groupBy(leadEvaluations.decision);
  const by = (decision: string) =>
    verdicts.find((row) => row.decision === decision)?.total ?? 0;
  const qualified = by("qualify");
  const held = by("review");
  const rejected = by("reject");
  return {
    read: qualified + held + rejected,
    qualified,
    held,
    rejected,
  };
}

function posts(total: number): string {
  return `${total} ${total === 1 ? "post" : "posts"}`;
}

function counts(report: ScanReport): string {
  return `We read ${posts(report.read)}, ${report.qualified} cleared the bar and ${report.held} held for review.`;
}

/**
 * What the leads page says above the feed. When the scan read nothing there is
 * nothing to report; when it read and the feed is still empty, the honest
 * answer is that people talk about this and none of them asked to buy.
 */
export function verdictSentence(report: ScanReport, leadsShown: number): string {
  if (report.read === 0) {
    return "No scan has read this window yet.";
  }
  if (leadsShown === 0) {
    return `Reddit talks about this, but nobody in this window asked to buy. ${counts(report)}`;
  }
  return counts(report);
}
