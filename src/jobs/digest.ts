import { allChannels, markSent, type ScheduledChannel } from "@/lib/alerts/channels";
import { config } from "@/lib/config";
import { newLeadsSince } from "@/lib/alerts/leads";
import {
  CADENCE_MS,
  CHAT_LEAD_CAP,
  effectiveCadence,
  isDue,
  selectLeads,
  windowStart,
} from "@/lib/alerts/select";
import { sendToChannel } from "@/lib/alerts/send";
import type { Digest } from "@/lib/alerts/types";
import { inFlight } from "@/lib/scan/constants";
import { tierForUser } from "@/lib/tier";
import type { TierLimits } from "@/lib/tiers";
import { enqueueOnce } from "./enqueue";

/** How many channels are delivered to at once. */
const SEND_CONCURRENCY = 5;

async function limitsCache(): Promise<(userId: string) => Promise<TierLimits | null>> {
  const seen = new Map<string, TierLimits | null>();
  return async (userId: string) => {
    if (!seen.has(userId)) {
      seen.set(userId, (await tierForUser(userId)).limits);
    }
    return seen.get(userId) ?? null;
  };
}

async function digestFor(
  channel: ScheduledChannel,
  limits: TierLimits | null,
  now: Date,
): Promise<Digest | null> {
  const cadence = effectiveCadence(channel.cadence, limits);
  if (!isDue(channel.lastSentAt, cadence, now)) {
    return null;
  }
  const since = windowStart(channel.lastSentAt, cadence, now);
  const rows = await newLeadsSince(channel.projectId, since);
  const leads = selectLeads(rows, since, channel.channel === "email" ? null : CHAT_LEAD_CAP);
  if (leads.length === 0) {
    return null;
  }
  return {
    projectName: channel.projectName,
    generatedAt: now,
    since,
    cadence,
    leads,
    appUrl: config().APP_URL,
  };
}

/**
 * One pass over every alert channel in the instance. A channel with nothing new
 * sends nothing and keeps its window open, so the leads land in the next one.
 */
export async function sendDueDigests(now = new Date()): Promise<number> {
  const limitsFor = await limitsCache();
  const failures: string[] = [];
  let sent = 0;
  // A few at a time, so one slow receiver holds up its own lane and not the hour.
  await inFlight(
    await allChannels(),
    async (channel) => {
      try {
        const digest = await digestFor(channel, await limitsFor(channel.userId), now);
        if (!digest) {
          return;
        }
        await sendToChannel(channel.channel, channel.target, digest);
        await markSent(channel.id, now);
        sent += 1;
      } catch (error) {
        failures.push(`${channel.channel} for ${channel.projectName}: ${String(error)}`);
      }
    },
    SEND_CONCURRENCY,
  );
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return sent;
}

/**
 * The scheduled job. It reschedules itself one hour out, which is the shortest
 * cadence any tier can ask for.
 */
export async function runDigest(): Promise<void> {
  try {
    await sendDueDigests();
  } finally {
    await enqueueOnce("digest", new Date(Date.now() + CADENCE_MS.hourly));
  }
}
