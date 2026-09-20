import type { TierLimits } from "@/lib/tiers";
import { excerptOf } from "./excerpt";
import {
  CUSTOM_WEBHOOK_CHANNEL,
  type AlertCadence,
  type AlertChannel,
  type DigestLead,
} from "./types";

/** How long one cadence waits between messages. */
export const CADENCE_MS: Record<AlertCadence, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

/** The contract's number: Slack and Discord carry the top five leads. */
export const CHAT_LEAD_CAP = 5;

/** The email lists this many and counts the rest, so a big day stays readable. */
export const EMAIL_LEAD_CAP = 20;

/** Below this a lead is in the feed and not worth a message. */
export const ALERT_SCORE_FLOOR = 55;

/**
 * How much older than the window's start a post or comment may be. A scan reads
 * a week or a month back, so what it finds today is not always from today, and
 * an alert is for a conversation that is still open.
 */
export const FRESH_SLACK_MS = CADENCE_MS.daily;

/**
 * What a channel actually sends at. A free-tier channel is daily whatever it
 * asked for; a connected wallet and a self-hosted instance get what they asked.
 */
export function effectiveCadence(
  requested: AlertCadence,
  limits: TierLimits | null,
): AlertCadence {
  if (!limits) {
    return requested;
  }
  return limits.alertCadence === "daily" ? "daily" : requested;
}

/** A channel is due when it has never sent, or its cadence has elapsed. */
export function isDue(lastSentAt: Date | null, cadence: AlertCadence, now: Date): boolean {
  if (!lastSentAt) {
    return true;
  }
  return now.getTime() - lastSentAt.getTime() >= CADENCE_MS[cadence];
}

/**
 * The start of the window a message covers: everything since the last send, or
 * one cadence back the first time, so a new channel does not open with a month.
 */
export function windowStart(lastSentAt: Date | null, cadence: AlertCadence, now: Date): Date {
  return lastSentAt ?? new Date(now.getTime() - CADENCE_MS[cadence]);
}

export type SelectableLead = Omit<DigestLead, "excerpt"> & {
  body: string | null;
  status: string;
  kind: string;
  foundAt: Date;
};

/**
 * Every lead worth a message, best first: a buyer the user has not touched,
 * first found inside the window, at or over the floor, on a post or comment
 * that is still fresh. The window is on `foundAt`, which a rescore never moves,
 * so consecutive windows carry each lead once.
 */
export function alertable(rows: SelectableLead[], since: Date): SelectableLead[] {
  const freshFrom = since.getTime() - FRESH_SLACK_MS;
  return rows
    .filter(
      (row) =>
        row.status === "new" &&
        row.kind === "buyer" &&
        row.score >= ALERT_SCORE_FLOOR &&
        row.foundAt.getTime() >= since.getTime() &&
        row.createdAt.getTime() >= freshFrom,
    )
    .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
}

/** The leads one message carries: the top `limit` of `alertable`. */
export function selectLeads(rows: SelectableLead[], since: Date, limit: number): DigestLead[] {
  return alertable(rows, since).slice(0, limit).map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    subreddit: row.subreddit,
    author: row.author,
    avatarUrl: row.avatarUrl,
    score: row.score,
    reason: row.reason,
    matchedPhrase: row.matchedPhrase,
    excerpt: excerptOf(row.body, row.matchedPhrase),
    isComment: row.isComment,
    numComments: row.numComments,
    createdAt: row.createdAt,
  }));
}

export function isCustomWebhook(channel: AlertChannel): boolean {
  return channel === CUSTOM_WEBHOOK_CHANNEL;
}

/** How many custom webhooks a project already has against what it may have. */
export function customWebhookAllowance(
  existing: AlertChannel[],
  limits: TierLimits | null,
): { used: number; limit: number | null; atCap: boolean } {
  const used = existing.filter(isCustomWebhook).length;
  const limit = limits?.customWebhooks ?? null;
  return { used, limit, atCap: limit != null && used >= limit };
}

/** The cap line the settings screen shows, or null when nothing is capped. */
export function customWebhookCapText(
  existing: AlertChannel[],
  limits: TierLimits | null,
): string | null {
  const { used, limit } = customWebhookAllowance(existing, limits);
  return limit == null ? null : `${used} of ${limit} custom webhook${limit === 1 ? "" : "s"}`;
}
