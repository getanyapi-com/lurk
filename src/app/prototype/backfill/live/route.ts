/* PROTOTYPE. What one project's backfill looks like right now, for the board. */
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, leadEvaluations, leads, llmUsage, redditPosts, candidateSources } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("project");
  if (!projectId) return NextResponse.json({ error: "project" }, { status: 400 });
  const [job] = await db()
    .select()
    .from(jobs)
    .where(sql`${jobs.projectId} = ${projectId} and ${jobs.kind} = 'backfill'`)
    .orderBy(desc(jobs.runAt))
    .limit(1);
  const [usage, evaluations, [found], [leadCount]] = await Promise.all([
    db()
      .select({
        purpose: llmUsage.purpose,
        calls: sql<number>`count(*)::int`,
        items: sql<number>`coalesce(sum(${llmUsage.itemsAsked}),0)::int`,
        usd: sql<number>`coalesce(sum(${llmUsage.costUsd}),0)::float`,
        ms: sql<number>`coalesce(sum(${llmUsage.latencyMs}),0)::int`,
      })
      .from(llmUsage)
      .where(eq(llmUsage.projectId, projectId))
      .groupBy(llmUsage.purpose),
    db()
      .select({
        id: leadEvaluations.postId,
        title: redditPosts.title,
        subreddit: redditPosts.subreddit,
        createdAt: redditPosts.createdAt,
        relationship: leadEvaluations.relationship,
        needState: leadEvaluations.needState,
        decision: leadEvaluations.decision,
        score: leadEvaluations.score,
        fit: leadEvaluations.fit,
        intent: leadEvaluations.intent,
        quote: leadEvaluations.evidenceQuote,
        reason: leadEvaluations.reason,
        judgedAt: leadEvaluations.judgedAt,
        stage: leads.stage,
        kind: leads.kind,
      })
      .from(leadEvaluations)
      .innerJoin(redditPosts, eq(redditPosts.id, leadEvaluations.postId))
      .leftJoin(leads, sql`${leads.projectId} = ${leadEvaluations.projectId} and ${leads.postId} = ${leadEvaluations.postId} and ${leads.commentId} is null`)
      .where(sql`${leadEvaluations.projectId} = ${projectId} and ${leadEvaluations.commentId} is null`)
      .orderBy(leadEvaluations.judgedAt),
    db()
      .select({ n: sql<number>`count(distinct ${candidateSources.postId})::int` })
      .from(candidateSources)
      .where(eq(candidateSources.projectId, projectId)),
    db().select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.projectId, projectId)),
  ]);
  return NextResponse.json({
    job: job ? { progress: job.progress, startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error } : null,
    usage,
    evaluations,
    found: found.n,
    leads: leadCount.n,
    now: new Date().toISOString(),
  });
}
