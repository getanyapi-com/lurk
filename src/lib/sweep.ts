import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import type { ProjectActivity } from "@/lib/projectActivity";
import { candidateSources, jobs } from "@/db/schema";
import { newLeadCount } from "@/lib/leads";

/**
 * A project's first sweep as it is happening, and the one line the leads page
 * reports it in. The sweep reads a title first and scores only the posts whose
 * title asks for something, so a found post ends one of two ways: set aside on
 * its title, or read in full and given a verdict.
 */

/** How long a sweep that has ended still says so over the feed, so its last line can be read. */
const SWEEP_LINGER_MS = 90 * 1000;

/** Whether the leads page reports the sweep: while it is queued or running, and just after. */
export function sweepShown(activity: ProjectActivity, now = new Date()): boolean {
  // The setup that comes before the sweep counts too: a new project lands here,
  // and the line says what is being read until the first leads are in.
  if (activity.active.some((job) => job.kind === "backfill" || job.kind === "discovery_initial")) {
    return true;
  }
  const last = activity.last;
  return (
    last?.kind === "backfill" &&
    last.finishedAt !== null &&
    now.getTime() - last.finishedAt.getTime() < SWEEP_LINGER_MS
  );
}

/**
 * A project's first sweep as the leads page reports it, over the feed it is
 * filling: which part of the work it is on, and how many leads it has put in
 * the feed so far. Read once a second while it runs, so it is two counts and
 * a row.
 */
export type SweepStatus = {
  state: "waiting" | "running" | "done" | "stopped";
  /** The progress line of whichever job is working: the setup, then the sweep. */
  progress: string | null;
  elapsedMs: number;
  /** Distinct posts the sweep's searches have turned up. */
  found: number;
  /** Leads waiting in the feed, which is the number the list under this shows. */
  feedLeads: number;
};

/** The first sweep this project has queued, running or ended, as it stands now. */
export async function sweepStatus(projectId: string): Promise<SweepStatus | null> {
  const [job] = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, "backfill")))
    .orderBy(desc(jobs.runAt))
    .limit(1);
  if (!job?.startedAt) {
    const [setup] = job
      ? []
      : await db()
          .select({ progress: jobs.progress })
          .from(jobs)
          .where(
            and(eq(jobs.projectId, projectId), eq(jobs.kind, "discovery_initial"), isNull(jobs.finishedAt)),
          )
          .limit(1);
    if (!job && !setup) {
      return null;
    }
    return { state: "waiting", progress: setup?.progress ?? null, elapsedMs: 0, found: 0, feedLeads: 0 };
  }
  const start = job.startedAt;
  const [[found], feedLeads] = await Promise.all([
    db()
      .select({ n: sql<number>`count(distinct ${candidateSources.postId})::int` })
      .from(candidateSources)
      .where(and(eq(candidateSources.projectId, projectId), gte(candidateSources.firstSeenAt, start))),
    newLeadCount(projectId),
  ]);
  return {
    state: job.error ? "stopped" : job.finishedAt ? "done" : "running",
    progress: job.progress,
    elapsedMs: (job.finishedAt ?? new Date()).getTime() - start.getTime(),
    found: found.n,
    feedLeads,
  };
}
