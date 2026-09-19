import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";

export type JobRow = typeof jobs.$inferSelect;

/**
 * Queues one job of a kind for a project, replacing any queued job of that kind
 * that has not started. A user pressing Scan now moves the schedule forward
 * rather than stacking a second scan behind it.
 */
export async function enqueueJob(
  kind: string,
  projectId: string | null,
  runAt = new Date(),
  manual = false,
): Promise<JobRow> {
  await db()
    .delete(jobs)
    .where(
      and(
        eq(jobs.kind, kind),
        isNull(jobs.startedAt),
        projectId === null ? isNull(jobs.projectId) : eq(jobs.projectId, projectId),
      ),
    );
  const rows = await db().insert(jobs).values({ kind, projectId, runAt, manual }).returning();
  return rows[0];
}

/**
 * Queues a job only when one of that kind is not already waiting, so a caller
 * that only needs the schedule to exist never moves a scan a user just asked
 * for. `projectId` defaults to the instance-wide jobs, which have none.
 */
export async function enqueueOnce(
  kind: string,
  runAt = new Date(),
  projectId: string | null = null,
): Promise<void> {
  const waiting = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, kind),
        isNull(jobs.startedAt),
        projectId === null ? isNull(jobs.projectId) : eq(jobs.projectId, projectId),
      ),
    )
    .limit(1);
  if (waiting.length === 0) {
    await db().insert(jobs).values({ kind, projectId, runAt });
  }
}

export async function writeProgress(jobId: string, progress: string): Promise<void> {
  await db().update(jobs).set({ progress }).where(eq(jobs.id, jobId));
}

/** The last job of a kind this project actually ran, or null before the first. */
export async function lastRunJob(kind: string, projectId: string): Promise<JobRow | null> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.kind, kind), eq(jobs.projectId, projectId)))
    .orderBy(sql`started_at desc nulls last`)
    .limit(1);
  return rows[0] ?? null;
}

/** The next job of a kind waiting for this project, or null when none is. */
export async function nextQueuedJob(kind: string, projectId: string): Promise<JobRow | null> {
  const rows = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.kind, kind), eq(jobs.projectId, projectId), isNull(jobs.startedAt)))
    .orderBy(asc(jobs.runAt))
    .limit(1);
  return rows[0] ?? null;
}

/** The next scan waiting for this project, or null when none is scheduled. */
export async function nextScanJob(projectId: string): Promise<JobRow | null> {
  return nextQueuedJob("scan", projectId);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When this project may press Scan now again, or null when it may now. A press
 * counts for 24 hours from when it was made; one whose scan failed gives the
 * press back, because it bought nothing. Null `perDay` means no limit.
 */
export async function nextManualScanAt(
  projectId: string,
  perDay: number | null,
  now = new Date(),
): Promise<Date | null> {
  if (perDay === null) {
    return null;
  }
  const presses = await db()
    .select({ runAt: jobs.runAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "scan"),
        eq(jobs.projectId, projectId),
        eq(jobs.manual, true),
        isNull(jobs.error),
        gte(jobs.runAt, new Date(now.getTime() - DAY_MS)),
      ),
    )
    .orderBy(asc(jobs.runAt));
  if (presses.length < perDay) {
    return null;
  }
  return new Date(presses[presses.length - perDay].runAt.getTime() + DAY_MS);
}
