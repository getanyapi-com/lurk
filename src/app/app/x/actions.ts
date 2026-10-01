"use server";

import { revalidatePath } from "next/cache";
import { kickScheduler } from "@/jobs/scheduler";
import type { ActionResult } from "@/lib/actionResult";
import { markThreadReplied, reopenThread } from "@/lib/handled";
import { requireXProject } from "@/lib/owned";
import { pressForJob } from "@/lib/throttle";
import { openX } from "@/lib/x/open";
import { markLanesDue } from "@/lib/x/run";
import { setXLeadStatus, xLeadConversation } from "@/lib/x/write";

/**
 * The tab is on screen: the first open queues the first check, later opens
 * keep the recurring scan alive. Fired by a mounted page, never by its render,
 * so a prefetched link buys nothing.
 */
export async function openXAction(projectId: string) {
  await requireXProject(projectId);
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
  const { user } = await requireXProject(projectId);
  await pressForJob(user.id, "x_scan_now", "x_scan", projectId);
  await markLanesDue(projectId);
  kickScheduler();
  revalidatePath("/app/x");
}

/**
 * The user answered it on X: its conversation leaves New and the rail's count
 * and stays under Replied, and no alert channel carries an ask from it again.
 */
export async function repliedXLeadAction(projectId: string, leadId: string) {
  await requireXProject(projectId);
  // The whole conversation: other asks in it, and later ones, are the same thread answered.
  const conversation = await xLeadConversation(projectId, leadId);
  if (conversation) {
    await markThreadReplied(projectId, "x", conversation);
  }
  revalidatePath("/app", "layout");
}

/** Takes Replied back: the conversation's leads are new again, and later ones arrive as before. */
export async function reopenXLeadAction(projectId: string, leadId: string) {
  await requireXProject(projectId);
  const conversation = await xLeadConversation(projectId, leadId);
  if (conversation) {
    await reopenThread(projectId, "x", conversation);
  }
  revalidatePath("/app", "layout");
}

export async function hideXLeadAction(projectId: string, leadId: string) {
  await requireXProject(projectId);
  await setXLeadStatus(projectId, leadId, "hidden", null);
  revalidatePath("/app", "layout");
}

export async function notFitXLeadAction(projectId: string, leadId: string, formData: FormData): Promise<ActionResult> {
  await requireXProject(projectId);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 80);
  if (!reason) {
    return { error: "Pick a reason before marking a lead as not a fit" };
  }
  await setXLeadStatus(projectId, leadId, "not_fit", reason);
  revalidatePath("/app", "layout");
  return { error: null };
}
