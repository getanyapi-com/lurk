import { enqueueJob, lastRunJob } from "@/jobs/enqueue";
import { kickScheduler } from "@/jobs/scheduler";
import { clusterableFoundAfter } from "@/lib/insights/themes";
import { requireOwnedProject } from "@/lib/owned";
import { smallSweep } from "@/lib/sweepScale";

/**
 * Queues a tab's job the first time the tab is opened, and never again: once a
 * job of the kind exists it books its own successor. Called from a Server
 * Action a mounted page fires, not from the page's render, so a prefetched
 * link buys nothing.
 */
export async function startOnOpen(kind: "seo_refresh" | "competitor_scan", projectId: string): Promise<boolean> {
  await requireOwnedProject(projectId);
  // A trial-size project buys its sweep and nothing after it.
  if (smallSweep() || (await lastRunJob(kind, projectId))) {
    return false;
  }
  await enqueueJob(kind, projectId);
  kickScheduler();
  return true;
}

/**
 * Groups a project's leads again when its Insights tab is opened and leads it
 * would group have arrived since the last grouping began. Themes are only read
 * on that tab (and through the API), so grouping after every scan paid for
 * themes nobody saw.
 */
export async function regroupOnOpen(projectId: string): Promise<boolean> {
  await requireOwnedProject(projectId);
  const last = await lastRunJob("insights", projectId);
  if (last && !last.finishedAt) {
    return false;
  }
  if (!(await clusterableFoundAfter(projectId, last?.startedAt ?? null))) {
    return false;
  }
  await enqueueJob("insights", projectId);
  kickScheduler();
  return true;
}
