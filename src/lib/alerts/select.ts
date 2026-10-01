import { wordsOf } from "@/lib/filterWords";
import { ALERT_SCORE_FLOOR } from "@/lib/leadFilters";
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

/**
 * The house floor is on the Reddit lead model's scale. An X ask has already
 * passed X's own gates (src/lib/x/gates.ts `decide`), and its score only orders
 * asks: a qualified ask with fit 1 and intent 2 folds to 30, so Reddit's floor
 * would silently drop real asks. X asks have none. A project that set its own
 * (lib/leadFilters.ts) has it on the row, read with the lead.
 */
function floorFor(row: SelectableLead): number {
  return row.floor ?? (row.platform === "x" ? 0 : ALERT_SCORE_FLOOR);
}

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
  /** The thread the lead is in, whether it is the post itself or a reply. */
  postId: string;
  body: string | null;
  status: string;
  kind: string;
  foundAt: Date;
  /** The least score this project alerts at on this platform, when the query read it. */
  floor?: number;
};

export function sameWords(a: string, b: string): boolean {
  return wordsOf(a) === wordsOf(b);
}

/**
 * A reply whose only evidence is the thread's own title was judged on the
 * question it answers, not on what it says: in practice it is someone
 * recommending a tool, not someone asking for one.
 */
function borrowsTheQuestion(row: SelectableLead): boolean {
  return row.isComment && row.matchedPhrase != null && sameWords(row.matchedPhrase, row.title);
}

/**
 * The moment a post must be newer than, less the slack. Fresh is measured from
 * the window's start. An X ask is also measured from `askFloor`, which the
 * digest sets one cadence before now: a first look writes a month of asks as
 * found now, and a channel quiet for weeks has a window as long. Reddit keeps
 * the window alone, so a channel that could not deliver for a while still
 * sends what it missed.
 */
function freshFrom(row: SelectableLead, since: Date, askFloor: Date): number {
  const from = row.platform === "x" ? Math.max(since.getTime(), askFloor.getTime()) : since.getTime();
  return from - FRESH_SLACK_MS;
}

/**
 * Each platform's leads best first by its own score, the platforms taking
 * turns, Reddit first. An X ask's score is not on the Reddit lead model's
 * scale, so one list sorted by both would put asks wherever the scales happen
 * to cross, and a chat channel's five could hold none of them.
 */
function inTurns(rows: SelectableLead[]): SelectableLead[] {
  const lanes = (["reddit", "x"] as const).map((platform) =>
    rows.filter((row) => row.platform === platform),
  );
  const longest = Math.max(...lanes.map((lane) => lane.length));
  const turns: SelectableLead[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const lane of lanes) {
      if (index < lane.length) {
        turns.push(lane[index]);
      }
    }
  }
  return turns;
}

/**
 * Every lead worth a message, in the order a message lists them: a buyer the
 * user has not touched, first found inside the window, at or over its floor,
 * on a post or comment that is still fresh. The window is on `foundAt`, which a
 * rescore never moves, so consecutive windows carry each lead once.
 */
export function alertable(
  rows: SelectableLead[],
  since: Date,
  askFloor: Date = since,
): SelectableLead[] {
  const fresh = rows
    .filter(
      (row) =>
        row.status === "new" &&
        row.kind === "buyer" &&
        row.score >= floorFor(row) &&
        !borrowsTheQuestion(row) &&
        row.foundAt.getTime() >= since.getTime() &&
        row.createdAt.getTime() >= freshFrom(row, since, askFloor),
    )
    .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
  return inTurns(fresh);
}

/**
 * One message's split of `alertable`, ranked once: the first `limit` as the
 * leads it lists, and the rest it only counts.
 */
export function messageLeads(
  rows: SelectableLead[],
  since: Date,
  limit: number,
  askFloor: Date = since,
): { leads: DigestLead[]; rest: SelectableLead[] } {
  const ranked = alertable(rows, since, askFloor);
  return { leads: ranked.slice(0, limit).map(digestLead), rest: ranked.slice(limit) };
}

export function digestLead(row: SelectableLead): DigestLead {
  return {
    id: row.id,
    platform: row.platform,
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
    threadId: row.postId,
    numComments: row.numComments,
    createdAt: row.createdAt,
  };
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
