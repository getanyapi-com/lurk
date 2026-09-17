import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiRequestCounts } from "@/db/schema/api";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyCount = { used: number; limit: number | null; retryAfterSeconds: number };

/** The UTC calendar day a request counts against. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Seconds until the counter rolls over, which is what Retry-After holds. */
export function secondsUntilReset(at: Date = new Date()): number {
  const nextMidnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) + DAY_MS;
  return Math.max(1, Math.ceil((nextMidnight - at.getTime()) / 1000));
}

/**
 * Counts one request against a key's day and says whether it may be served.
 * The upsert is the whole mechanism: concurrent requests serialize on the
 * primary key, so the count cannot drift. A null limit still counts the
 * request, so `/me` can report the day, but never refuses one.
 */
export async function consumeDailyRequest(
  keyId: string,
  limit: number | null,
  at: Date = new Date(),
): Promise<DailyCount & { allowed: boolean }> {
  const day = utcDay(at);
  const rows = await db()
    .insert(apiRequestCounts)
    .values({ keyId, day, count: 1 })
    .onConflictDoUpdate({
      target: [apiRequestCounts.keyId, apiRequestCounts.day],
      set: { count: sql`${apiRequestCounts.count} + 1` },
    })
    .returning({ count: apiRequestCounts.count });
  const used = rows[0]?.count ?? 1;
  return {
    used,
    limit,
    allowed: limit === null || used <= limit,
    retryAfterSeconds: secondsUntilReset(at),
  };
}

/** What a key has already spent today, without spending another request. */
export async function requestsToday(keyId: string, at: Date = new Date()): Promise<number> {
  const rows = await db()
    .select({ count: apiRequestCounts.count })
    .from(apiRequestCounts)
    .where(and(eq(apiRequestCounts.keyId, keyId), eq(apiRequestCounts.day, utcDay(at))));
  return rows[0]?.count ?? 0;
}
