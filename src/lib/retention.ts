import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditPosts, seoOpportunities } from "@/db/schema";
import { RETENTION_DAYS } from "./tiers";

/** The oldest post creation time we still keep. */
export function retentionCutoff(now: Date, days = RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Posts dropped per statement, so no one delete holds its row locks for long. */
export const RETENTION_BATCH = 500;

/**
 * Drops shared Reddit posts past the retention window. A post someone is still
 * shown - a lead in a feed, a thread in the Reddit SEO tab - is kept however
 * old it is, because the age of a ranking thread is the whole point of it.
 * Comments and evaluations still go with the post, because they cascade.
 *
 * A batch at a time, each its own statement: one delete over every expired
 * post ran for hours on 2026-09-30, holding locks that stalled the scans'
 * post upserts until they held the whole connection pool, and every page hung.
 */
export async function deleteExpiredPosts(
  now = new Date(),
  batch = RETENTION_BATCH,
): Promise<number> {
  const expired = db()
    .select({ id: redditPosts.id })
    .from(redditPosts)
    .where(
      and(
        lt(redditPosts.createdAt, retentionCutoff(now)),
        notExists(
          db().select({ one: sql`1` }).from(leads).where(eq(leads.postId, redditPosts.id)),
        ),
        notExists(
          db()
            .select({ one: sql`1` })
            .from(seoOpportunities)
            .where(eq(seoOpportunities.postId, redditPosts.id)),
        ),
      ),
    )
    .limit(batch);
  let total = 0;
  for (;;) {
    const deleted = await db()
      .delete(redditPosts)
      .where(inArray(redditPosts.id, expired))
      .returning({ id: redditPosts.id });
    total += deleted.length;
    if (deleted.length < batch) {
      return total;
    }
  }
}
