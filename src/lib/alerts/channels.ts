import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alerts, projects } from "@/db/schema";
import type { TierLimits } from "@/lib/tiers";
import { customWebhookAllowance, isCustomWebhook } from "./select";
import { CHANNEL_LABELS, type AlertCadence, type AlertChannel } from "./types";

export type AlertRow = typeof alerts.$inferSelect;

export type ProjectChannel = AlertRow & {
  channel: AlertChannel;
  cadence: AlertCadence;
};

const emailTarget = z.email();
const urlTarget = z.url();

function typed(row: AlertRow): ProjectChannel {
  return {
    ...row,
    channel: row.channel as AlertChannel,
    cadence: row.cadence === "hourly" ? "hourly" : "daily",
  };
}

/** Every channel on one project, oldest first. */
export async function listChannels(projectId: string): Promise<ProjectChannel[]> {
  const rows = await db()
    .select()
    .from(alerts)
    .where(eq(alerts.projectId, projectId))
    .orderBy(asc(alerts.id));
  return rows.map(typed);
}

/**
 * Checks the address is the shape its channel needs. Slack and Discord publish
 * their webhook hosts, so a typo there is caught before the first send.
 */
export function normalizeTarget(channel: AlertChannel, raw: string): string {
  const target = raw.trim();
  if (channel === "email") {
    if (!emailTarget.safeParse(target).success) {
      throw new Error("That is not an email address");
    }
    return target;
  }
  if (!urlTarget.safeParse(target).success) {
    throw new Error(`${CHANNEL_LABELS[channel]} needs a webhook URL`);
  }
  const host = new URL(target).hostname;
  if (channel === "slack" && !host.endsWith("slack.com")) {
    throw new Error("A Slack webhook URL is on hooks.slack.com");
  }
  if (channel === "discord" && !/discord(app)?\.com$/.test(host)) {
    throw new Error("A Discord webhook URL is on discord.com");
  }
  return target;
}

export type AddChannelInput = {
  projectId: string;
  channel: AlertChannel;
  target: string;
  /** Shown in place of the target when set. */
  label?: string | null;
  cadence: AlertCadence;
  limits: TierLimits | null;
};

/** Adds a channel, refusing when the tier's webhook allowance is used up. */
export async function addChannel(input: AddChannelInput): Promise<ProjectChannel> {
  const target = normalizeTarget(input.channel, input.target);
  const existing = await listChannels(input.projectId);
  if (isCustomWebhook(input.channel)) {
    const allowance = customWebhookAllowance(
      existing.map((one) => one.channel),
      input.limits,
    );
    if (allowance.atCap) {
      throw new Error(
        `This tier allows ${allowance.limit} custom webhook${allowance.limit === 1 ? "" : "s"}. Connect a wallet for more.`,
      );
    }
  }
  if (existing.some((one) => one.channel === input.channel && one.target === target)) {
    throw new Error("That channel is already on this project");
  }
  const rows = await db()
    .insert(alerts)
    .values({
      projectId: input.projectId,
      channel: input.channel,
      target,
      label: input.label ?? null,
      cadence: input.cadence,
    })
    .returning();
  return typed(rows[0]);
}

export async function removeChannel(projectId: string, alertId: string): Promise<void> {
  await db()
    .delete(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.projectId, projectId)));
}

/** One channel, only when it hangs off the project asked for. */
export async function channelForProject(
  projectId: string,
  alertId: string,
): Promise<ProjectChannel | null> {
  const rows = await db()
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.projectId, projectId)));
  return rows[0] ? typed(rows[0]) : null;
}

export async function markSent(alertId: string, at: Date): Promise<void> {
  await db().update(alerts).set({ lastSentAt: at }).where(eq(alerts.id, alertId));
}

export type ScheduledChannel = ProjectChannel & {
  projectName: string;
  userId: string;
};

/** Every channel in the instance with the project and owner the job needs. */
export async function allChannels(): Promise<ScheduledChannel[]> {
  const rows = await db()
    .select({ alert: alerts, projectName: projects.name, userId: projects.userId })
    .from(alerts)
    .innerJoin(projects, eq(projects.id, alerts.projectId))
    .orderBy(asc(alerts.id));
  return rows.map((row) => ({
    ...typed(row.alert),
    projectName: row.projectName,
    userId: row.userId,
  }));
}
