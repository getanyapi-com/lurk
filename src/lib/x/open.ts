import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { jobs, xProjects } from "@/db/schema";
import { enqueueOnce } from "@/jobs/enqueue";

/**
 * The X tab was opened. X is never part of onboarding, so Reddit's first lead
 * does not wait on it and the house pays only for people who look at X: the
 * first open queues the first check, and every open after keeps the recurring
 * scan alive (a scan stops booking itself after a week unopened, unless an
 * alert channel carries the project's X asks).
 *
 * The caller has already checked the project is the user's and X is on for
 * them. Returns whether a scan was queued.
 */
export async function openX(projectId: string, now = new Date()): Promise<"scan" | "none"> {
  await db()
    .insert(xProjects)
    .values({ projectId, lastOpenedAt: now })
    .onConflictDoUpdate({ target: xProjects.projectId, set: { lastOpenedAt: now } });
  // A scan still waiting or running books the next one itself when it ends;
  // queueing another would only run an empty one behind it.
  const [unfinished] = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, "x_scan"), isNull(jobs.finishedAt)))
    .limit(1);
  if (unfinished) {
    return "none";
  }
  await enqueueOnce("x_scan", now, projectId);
  return "scan";
}
