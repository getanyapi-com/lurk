"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedProject } from "@/lib/owned";
import { regroupOnOpen, startOnOpen } from "@/lib/startOnOpen";
import { pressForJob } from "@/lib/throttle";
import type { PaidAction } from "@/lib/tiers";

// The buttons that queue one of a project's jobs, and the tabs that queue
// their first one when they are opened.

/** One press of a paid button, for a project that has to be the caller's. */
async function press(action: PaidAction, kind: string, projectId: string): Promise<void> {
  const { user } = await requireOwnedProject(projectId);
  await pressForJob(user.id, action, kind, projectId);
}

/** Queues a scan for one of the caller's projects, replacing any queued scan. */
export async function scanNowAction(projectId: string) {
  // Free has no presses at all: it scans once a day on its schedule.
  await press("scan_now", "scan", projectId);
  revalidatePath("/app", "layout");
}

/** The Competitors tab's first scan, which nothing else books. */
export async function openCompetitorsAction(projectId: string) {
  if (await startOnOpen("competitor_scan", projectId)) {
    revalidatePath("/app", "layout");
  }
}

/** Queues a look at what Reddit said about this project's competitors this week. */
export async function scanCompetitorsAction(projectId: string) {
  await press("competitor_scan", "competitor_scan", projectId);
  revalidatePath("/app/competitors");
}

/** Groups the leads that arrived since the last grouping, once the Insights tab is on screen. */
export async function openInsightsAction(projectId: string) {
  if (await regroupOnOpen(projectId)) {
    revalidatePath("/app", "layout");
  }
}

/** Queues a fresh grouping of this project's leads, replacing any queued one. */
export async function refreshInsightsAction(projectId: string) {
  await press("insights", "insights", projectId);
  revalidatePath("/app/insights");
}

/** The Reddit SEO tab's first refresh, which nothing else books. */
export async function openSeoAction(projectId: string) {
  if (await startOnOpen("seo_refresh", projectId)) {
    revalidatePath("/app", "layout");
  }
}

/** Queues a Reddit SEO refresh, replacing any refresh that has not started. */
export async function refreshSeoAction(projectId: string) {
  await press("seo_refresh", "seo_refresh", projectId);
  revalidatePath("/app", "layout");
}
