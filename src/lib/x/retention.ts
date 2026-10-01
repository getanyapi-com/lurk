import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { xAuthors, xLanes, xPosts, xRuns } from "@/db/schema";
import { deleteInBatches, RETENTION_BATCH } from "@/lib/retention";
import { daysAgo } from "@/lib/time";
import { RETENTION_DAYS } from "@/lib/tiers";

const RUN_HISTORY_DAYS = 90;

/**
 * Drops X content past the retention window. Unlike Reddit, a lead does not
 * keep its post: the tab shows seven days and an X lead is stale in hours, so
 * nothing is worth holding past thirty, and lurk keeps no archive of X. A post
 * goes once it was both written and fetched before the cutoff, so a parent
 * bought as context lives thirty days from its purchase. Its evaluations, leads
 * and run links cascade, each found through its own tweet_id index, and the
 * posts go a batch at a time, as Reddit's do (see deleteExpiredPosts).
 *
 * X's search_runs rows stay, as Reddit's do: they hold a query and a cost, no
 * X content. A retired lane goes with the run history, once it last ran (or
 * was made) that long ago; the verdicts that point at it keep their rows and
 * lose the link.
 */
export async function deleteExpiredXData(now = new Date()): Promise<{ posts: number; authors: number }> {
  const cutoff = daysAgo(RETENTION_DAYS, now);
  const expired = db()
    .select({ id: xPosts.id })
    .from(xPosts)
    .where(and(lt(xPosts.createdAt, cutoff), lt(xPosts.fetchedAt, cutoff)))
    .limit(RETENTION_BATCH);
  const posts = await deleteInBatches(async () => {
    const deleted = await db().delete(xPosts).where(inArray(xPosts.id, expired)).returning({ id: xPosts.id });
    return deleted.length;
  });
  const authors = await db()
    .delete(xAuthors)
    .where(lt(xAuthors.fetchedAt, cutoff))
    .returning({ username: xAuthors.username });
  const history = daysAgo(RUN_HISTORY_DAYS, now);
  await db().delete(xRuns).where(lt(xRuns.startedAt, history));
  await db()
    .delete(xLanes)
    .where(and(eq(xLanes.state, "retired"), sql`coalesce(${xLanes.lastRunAt}, ${xLanes.createdAt}) < ${history.toISOString()}::timestamptz`));
  return { posts, authors: authors.length };
}
