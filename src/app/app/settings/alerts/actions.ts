"use server";

import { revalidatePath } from "next/cache";
import { failure, type ActionResult } from "@/lib/actionResult";
import { addChannel, channelForProject, removeChannel } from "@/lib/alerts/channels";
import { sampleDigest } from "@/lib/alerts/fixtures";
import { CHAT_LEAD_CAP } from "@/lib/alerts/select";
import { sendToChannel } from "@/lib/alerts/send";
import { CHANNEL_LABELS, isAlertChannel } from "@/lib/alerts/types";
import { addMute, isMuteKind, removeMute } from "@/lib/mutes";
import { requireOwnedProject } from "@/lib/owned";

export type TestSendResult = { ok: boolean; message: string };

/**
 * Adds a channel, which the hourly digest job serves from its next pass. An
 * address the channel cannot take, a duplicate or a tier at its cap comes back
 * as the sentence the form shows.
 */
export async function addChannelAction(projectId: string, formData: FormData): Promise<ActionResult> {
  const { user } = await requireOwnedProject(projectId);
  const channel = String(formData.get("channel") ?? "");
  if (!isAlertChannel(channel)) {
    return { error: "Pick a channel" };
  }
  const cadence = formData.get("cadence") === "hourly" ? "hourly" : "daily";
  try {
    await addChannel({
      projectId,
      userId: user.id,
      channel,
      target: String(formData.get("target") ?? ""),
      cadence,
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/app/settings/alerts");
  return { error: null };
}

export async function removeChannelAction(projectId: string, alertId: string) {
  await requireOwnedProject(projectId);
  await removeChannel(projectId, alertId);
  revalidatePath("/app/settings/alerts");
}

/** Sends the three-lead sample down one channel and says what happened. */
export async function sendTestAction(
  projectId: string,
  alertId: string,
): Promise<TestSendResult> {
  const { project } = await requireOwnedProject(projectId);
  const channel = await channelForProject(projectId, alertId);
  if (!channel) {
    return { ok: false, message: "That channel is gone" };
  }
  const digest = sampleDigest(project.name);
  const leads = channel.channel === "email" ? digest.leads : digest.leads.slice(0, CHAT_LEAD_CAP);
  try {
    await sendToChannel(channel.channel, channel.target, { ...digest, leads });
    // A webhook URL is a secret, so the reply names the channel, not the address.
    const where =
      channel.label ?? (channel.channel === "email" ? channel.target : CHANNEL_LABELS[channel.channel]);
    return { ok: true, message: `Sent a sample to ${where}` };
  } catch (error) {
    return { ok: false, message: String(error instanceof Error ? error.message : error) };
  }
}

/** Mutes a keyword or a subreddit for the project, in the feed and every channel. */
export async function addMuteAction(projectId: string, formData: FormData): Promise<ActionResult> {
  await requireOwnedProject(projectId);
  const kind = String(formData.get("kind") ?? "");
  if (!isMuteKind(kind)) {
    return { error: "Pick a keyword or a subreddit" };
  }
  try {
    await addMute(projectId, kind, String(formData.get("value") ?? ""));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/app", "layout");
  return { error: null };
}

export async function removeMuteAction(projectId: string, muteId: string) {
  await requireOwnedProject(projectId);
  await removeMute(projectId, muteId);
  revalidatePath("/app", "layout");
}
