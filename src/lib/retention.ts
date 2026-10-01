import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditPosts, seoOpportunities } from "@/db/schema";
import { RETENTION_DAYS } from "./tiers";

/** The oldest post creation time we still keep. */
export function retentionCutoff(now: Date, days = RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Rows dropped per statement, so no one delete holds its row locks for long. */
export const RETENTION_BATCH = 500;

/**
 * Runs a delete of at most one batch again and again, until a pass takes
 * fewer than a batch, and says how many rows went in all. `pass` deletes one
 * batch and says how many it took.
 */
export async function deleteInBatches(
  pass: () => Promise<number>,
  batch = RETENTION_BATCH,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await pass();
    total += deleted;
    if (deleted < batch) {
      return total;
    }
  }
}

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
  return deleteInBatches(async () => {
    const deleted = await db()
      .delete(redditPosts)
      .where(inArray(redditPosts.id, expired))
      .returning({ id: redditPosts.id });
    return deleted.length;
  }, batch);
}

/** How long the queue keeps a finished job, unless it is the newest of its kind. */
export const JOB_HISTORY_DAYS = 30;

/**
 * Drops the queue's finished jobs once they are a month old. The newest
 * finished job of each kind for each project stays however old it is: pages
 * say when a project last ran something and how it ended (lastRunJob,
 * sweepStatus, the X tab, projectActivity), and the boot sweeps ask whether a
 * one-off ever ran for a project. A job not yet finished is never touched.
 *
 * The newest is both the last of them to start and the last to finish, and
 * both are kept. Two jobs of one kind for one project never run at once, so
 * those are nearly always one row; when they are not, keeping the two costs a
 * row and guesses at nothing. The instance-wide jobs, which have no project,
 * are one group per kind.
 */
export async function pruneFinishedJobs(
  now = new Date(),
  batch = RETENTION_BATCH,
): Promise<number> {
  const cutoff = retentionCutoff(now, JOB_HISTORY_DAYS).toISOString();
  return deleteInBatches(async () => {
    const deleted = await db().execute<{ id: string }>(sql`
      delete from jobs where id in (
        select id from (
          select id, finished_at,
            row_number() over (
              partition by project_id, kind order by started_at desc nulls last
            ) as by_start,
            row_number() over (partition by project_id, kind order by finished_at desc) as by_finish
          from jobs
          where finished_at is not null
        ) ranked
        where finished_at < ${cutoff}::timestamptz and by_start > 1 and by_finish > 1
        limit ${batch}
      )
      returning id
    `);
    return deleted.length;
  }, batch);
}
