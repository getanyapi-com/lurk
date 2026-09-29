"use server";

import { revalidatePath } from "next/cache";
import { kickScheduler } from "@/jobs/scheduler";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { pressForJob } from "@/lib/throttle";
import { xEnabledFor } from "@/lib/x/enabled";
import { openX } from "@/lib/x/open";
import { markLanesDue } from "@/lib/x/run";
import { setXLeadStatus } from "@/lib/x/write";

/** The caller's user, once the project is theirs and X is on for them. */
async function ownedXProject(projectId: string) {
  const user = await requireLocalUser();
  if (!xEnabledFor(user.id)) {
    throw new Error("X leads is not turned on");
  }
  if (!(await projectForUser(user.id, projectId))) {
    throw new Error("That project is not yours");
  }
  return user;
}

/**
 * The tab is on screen: the first open queues the first check, later opens
 * keep the recurring scan alive. Fired by a mounted page, never by its render,
 * so a prefetched link buys nothing.
 */
export async function openXAction(projectId: string) {
  await ownedXProject(projectId);
  if ((await openX(projectId)) !== "none") {
    kickScheduler();
    revalidatePath("/app", "layout");
  }
}

/**
 * Scan now: every search of the project is due at once, within the day's page
 * budget. The press is taken first, so a refused press changes nothing.
 */
export async function scanXNowAction(projectId: string) {
  const user = await ownedXProject(projectId);
  await pressForJob(user.id, "x_scan_now", "x_scan", projectId);
  await markLanesDue(projectId);
  kickScheduler();
  revalidatePath("/app/x");
}

/** The user answered it on X: it leaves New and the rail's count, and stays under Replied. */
export async function repliedXLeadAction(projectId: string, leadId: string) {
  await ownedXProject(projectId);
  await setXLeadStatus(projectId, leadId, "replied", null);
  revalidatePath("/app", "layout");
}

export async function hideXLeadAction(projectId: string, leadId: string) {
  await ownedXProject(projectId);
  await setXLeadStatus(projectId, leadId, "hidden", null);
  revalidatePath("/app", "layout");
}

export async function notFitXLeadAction(projectId: string, leadId: string, formData: FormData) {
  await ownedXProject(projectId);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 80);
  if (!reason) {
    throw new Error("Pick a reason before marking a lead as not a fit");
  }
  await setXLeadStatus(projectId, leadId, "not_fit", reason);
  revalidatePath("/app", "layout");
}
