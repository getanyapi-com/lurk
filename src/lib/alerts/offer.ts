import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userActions } from "@/db/schema";
import { addChannel, describeTarget, listChannels } from "./channels";
import { config } from "@/lib/config";
import { digestSubject, renderDigestHtml } from "./digest";
import { sampleDigest } from "./fixtures";
import { sampleLeads } from "./invite";
import { CHAT_LEAD_CAP } from "./select";
import type { AlertChannel, Digest } from "./types";
import { discordPayload, slackPayload } from "./webhooks";

/**
 * The offer a new project makes while its first leads are found: a daily email
 * or a Slack post, asked once. A person who never turns a channel on is only
 * shown leads when they come back to look, and threads go quiet within a day,
 * so the half minute they already spend watching the sweep is when to ask.
 */

/** Recorded per project, so "Not now" on one project leaves the next one free to ask. */
const DISMISSED = "alerts_offer_dismissed";

function dismissedAction(projectId: string): string {
  return `${DISMISSED}:${projectId}`;
}

/** One channel the project already sends to, as the offer names it. */
export type OfferedChannel = { channel: AlertChannel; where: string };

export type AlertsOffer =
  | { state: "ask"; email: string | null }
  | { state: "on"; channels: OfferedChannel[] }
  | { state: "dismissed" };

/**
 * What the offer says on one project: ask, say where alerts go, or nothing.
 * `email` is the address on the caller's row, which the page already holds.
 */
export async function alertsOffer(userId: string, projectId: string, email: string | null): Promise<AlertsOffer> {
  const channels = await listChannels(projectId);
  if (channels.length > 0) {
    return {
      state: "on",
      channels: channels.map((one) => ({
        channel: one.channel,
        // A webhook URL is a secret, so it is described, never shown whole.
        where: describeTarget(one.channel, one.target, one.label),
      })),
    };
  }
  const dismissed = await db()
    .select({ id: userActions.id })
    .from(userActions)
    .where(and(eq(userActions.userId, userId), eq(userActions.action, dismissedAction(projectId))))
    .limit(1);
  if (dismissed.length > 0) {
    return { state: "dismissed" };
  }
  return { state: "ask", email: email || null };
}

/** Turns on a daily email to the person's own address. Pressing it twice adds nothing. */
export async function turnOnEmailAlerts(userId: string, projectId: string): Promise<void> {
  const [user] = await db().select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user?.email) {
    throw new Error("Your account has no email address");
  }
  await addChannel({ projectId, userId, channel: "email", target: user.email, cadence: "daily", ifMissing: true });
}

/** Turns on a daily Discord post to a pasted webhook URL. */
export async function turnOnDiscordAlerts(userId: string, projectId: string, url: string): Promise<void> {
  await addChannel({ projectId, userId, channel: "discord", target: url, cadence: "daily" });
}

/** How many leads each preview carries: enough to show the shape without a wall. */
const PREVIEW_LEADS = 2;

/**
 * The messages the offer draws, made by the same renderers the digest job sends
 * with, so the preview cannot drift from what lands. The leads are this
 * project's own best, one per thread, or the fixed samples until it has some.
 */
export type OfferPreview = {
  sample: boolean;
  emailHtml: string;
  /** The subject line and sending address, for the inbox header drawn above the email. */
  emailSubject: string;
  emailFrom: string;
  slack: ReturnType<typeof slackPayload>;
  discord: ReturnType<typeof discordPayload>;
};

export async function offerPreview(projectId: string, projectName: string, now = new Date()): Promise<OfferPreview> {
  const own = (await sampleLeads(projectId, now)).slice(0, PREVIEW_LEADS);
  const base = sampleDigest(projectName, now);
  const digest: Digest = {
    ...base,
    leads: own.length > 0 ? own : base.leads.slice(0, PREVIEW_LEADS),
  };
  const chat = { ...digest, leads: digest.leads.slice(0, CHAT_LEAD_CAP) };
  return {
    sample: own.length === 0,
    emailHtml: renderDigestHtml(digest),
    emailSubject: digestSubject(digest),
    emailFrom: config().ALERTS_FROM_EMAIL ?? "alerts@lurk.so",
    slack: slackPayload(chat),
    discord: discordPayload(chat),
  };
}

/** "Not now": the offer is not shown on this project again. */
export async function dismissAlertsOffer(userId: string, projectId: string): Promise<void> {
  await db().insert(userActions).values({ userId, action: dismissedAction(projectId) });
}

/**
 * Where Add to Slack may send a person back to when it is done: a path inside
 * the app, never another host, so the parameter cannot be turned into an open
 * redirect.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/app/") || raw.startsWith("//") || raw.includes("\\")) {
    return null;
  }
  return raw;
}
