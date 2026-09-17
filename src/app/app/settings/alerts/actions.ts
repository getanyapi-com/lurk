"use server";

import { revalidatePath } from "next/cache";
import { enqueueOnce } from "@/jobs/enqueue";
import { addChannel, channelForProject, removeChannel } from "@/lib/alerts/channels";
import { sampleDigest } from "@/lib/alerts/fixtures";
import { CHAT_LEAD_CAP } from "@/lib/alerts/select";
import { sendToChannel } from "@/lib/alerts/send";
import { CHANNEL_LABELS, isAlertChannel } from "@/lib/alerts/types";
import { requireLocalUser } from "@/lib/auth";
import { projectForUser } from "@/lib/projects";
import { tierForUser } from "@/lib/tier";

async function ownedProject(projectId: string) {
  const user = await requireLocalUser();
  const project = await projectForUser(user.id, projectId);
  if (!project) {
    throw new Error("That project is not yours");
  }
  return { user, project };
}

export type TestSendResult = { ok: boolean; message: string };

/** Adds a channel and makes sure the digest job is queued to serve it. */
export async function addChannelAction(projectId: string, formData: FormData) {
  const { user } = await ownedProject(projectId);
  const channel = String(formData.get("channel") ?? "");
  if (!isAlertChannel(channel)) {
    throw new Error("Pick a channel");
  }
  const cadence = formData.get("cadence") === "hourly" ? "hourly" : "daily";
  const { limits } = await tierForUser(user.id);
  await addChannel({
    projectId,
    channel,
    target: String(formData.get("target") ?? ""),
    cadence,
    limits,
  });
  await enqueueOnce("digest");
  revalidatePath("/app/settings/alerts");
}

export async function removeChannelAction(projectId: string, alertId: string) {
  await ownedProject(projectId);
  await removeChannel(projectId, alertId);
  revalidatePath("/app/settings/alerts");
}

/** Sends the three-lead sample down one channel and says what happened. */
export async function sendTestAction(
  projectId: string,
  alertId: string,
): Promise<TestSendResult> {
  const { project } = await ownedProject(projectId);
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
