import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { llmUsage, usageLedger, xRuns } from "@/db/schema";
import { X_PURPOSES, X_SKUS } from "./constants";

/** The funnel of one X scan, so the tab can say what happened and what it cost. */

export type XRunCounts = {
  lanesRun: number;
  pages: number;
  emptyPages: number;
  fullPages: number;
  postsFetched: number;
  postsNew: number;
  screenedOut: Record<string, number>;
  parents: number;
  judged: number;
  profiles: number;
  finals: number;
  replyChecks: number;
  leads: number;
  replies: number;
  reviews: number;
};

export function emptyCounts(): XRunCounts {
  return {
    lanesRun: 0,
    pages: 0,
    emptyPages: 0,
    fullPages: 0,
    postsFetched: 0,
    postsNew: 0,
    screenedOut: {},
    parents: 0,
    judged: 0,
    profiles: 0,
    finals: 0,
    replyChecks: 0,
    leads: 0,
    replies: 0,
    reviews: 0,
  };
}

export async function startXRun(projectId: string, jobId: string | null) {
  const [run] = await db().insert(xRuns).values({ projectId, jobId }).returning();
  return run;
}

/** Stamps the first lead once; the time from the first scan's start to it is the X time-to-first-lead. */
export async function markFirstLead(runId: string) {
  await db()
    .update(xRuns)
    .set({ firstLeadAt: sql`now()` })
    .where(and(eq(xRuns.id, runId), isNull(xRuns.firstLeadAt)));
}

/** What X spent for this project since a moment: its twitter.* lines and its X model calls. */
export async function xSpendSince(projectId: string, since: Date): Promise<{ dataUsd: number; llmUsd: number }> {
  const [data] = await db()
    .select({ total: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(and(eq(usageLedger.projectId, projectId), inArray(usageLedger.sku, [...X_SKUS]), gte(usageLedger.at, since)));
  const [llm] = await db()
    .select({ total: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)` })
    .from(llmUsage)
    .where(and(eq(llmUsage.projectId, projectId), inArray(llmUsage.purpose, [...X_PURPOSES]), gte(llmUsage.at, since)));
  return { dataUsd: Number(data?.total ?? 0), llmUsd: Number(llm?.total ?? 0) };
}

export async function finishXRun(
  run: { id: string; projectId: string; startedAt: Date },
  counts: XRunCounts,
  partialReason: string | null,
) {
  const spend = await xSpendSince(run.projectId, run.startedAt);
  await db()
    .update(xRuns)
    .set({
      ...counts,
      finishedAt: new Date(),
      dataUsd: spend.dataUsd.toFixed(6),
      llmUsd: spend.llmUsd.toFixed(6),
      partialReason,
    })
    .where(eq(xRuns.id, run.id));
}
