import type { TierLimits } from "@/lib/tiers";
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

export type SelectableLead = DigestLead & { status: string; scoredAt: Date };

/**
 * The leads one message carries: still new, scored inside the window, best
 * first. `limit` is null for the email digest, which lists every one of them.
 */
export function selectLeads(
  rows: SelectableLead[],
  since: Date,
  limit: number | null,
): DigestLead[] {
  const inWindow = rows
    .filter((row) => row.status === "new" && row.scoredAt.getTime() >= since.getTime())
    .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
  const kept = limit == null ? inWindow : inWindow.slice(0, limit);
  return kept.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    subreddit: row.subreddit,
    author: row.author,
    avatarUrl: row.avatarUrl,
    score: row.score,
    reason: row.reason,
    matchedPhrase: row.matchedPhrase,
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
