import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { enqueueJob, lastRunJob } from "@/jobs/enqueue";
import { kickScheduler } from "@/jobs/scheduler";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { smallSweep } from "@/lib/sweepScale";

/**
 * Queues a tab's job the first time the tab is opened, and never again: once a
 * job of the kind exists it books its own successor. Called from a Server
 * Action a mounted page fires, not from the page's render, so a prefetched
 * link buys nothing.
 */
export async function startOnOpen(kind: "seo_refresh" | "competitor_scan", projectId: string): Promise<boolean> {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  // A trial-size project buys its sweep and nothing after it.
  if (smallSweep() || (await lastRunJob(kind, projectId))) {
    return false;
  }
  await enqueueJob(kind, projectId);
  kickScheduler();
  return true;
}

/**
 * Groups a project's leads again when its Insights tab is opened and leads have
 * arrived since the last grouping began. Themes are only read on that tab (and
 * through the API), so grouping after every scan paid for themes nobody saw.
 */
export async function regroupOnOpen(projectId: string): Promise<boolean> {
  const user = await requireLocalUser();
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  const last = await lastRunJob("insights", projectId);
  if (last && !last.finishedAt) {
    return false;
  }
  const [newer] = await db()
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(eq(leads.projectId, projectId), last?.startedAt ? gt(leads.foundAt, last.startedAt) : undefined),
    )
    .limit(1);
  if (!newer) {
    return false;
  }
  await enqueueJob("insights", projectId);
  kickScheduler();
  return true;
}
