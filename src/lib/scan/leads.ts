import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditPosts } from "@/db/schema";
import type { StoredPost } from "@/lib/reddit/store";
import { MIN_COMMENTS_FOR_THREAD } from "./constants";
import type { LeadKind } from "./gates";

export type LeadRow = {
  projectId: string;
  postId: string;
  commentId: string | null;
  /** Which lane the feed shows this in: an ask, or a thread worth a comment. */
  kind: LeadKind;
  score: number;
  /** The model's 0-4 scales. Null when the evidence could not establish one. */
  fit: number | null;
  intent: number | null;
  /** 0-4, computed in code from the item's age and comment count. */
  engagement: number;
  stage: string;
  reason: string;
  matchedPhrase: string;
};

/** One lead per project per post, or per project per comment. */
export function leadKey(postId: string, commentId: string | null): string {
  return commentId ? `comment:${commentId}` : `post:${postId}`;
}

/**
 * One row per key, the last one written. Postgres rejects a whole
 * `on conflict do update` statement that carries the same conflict key twice
 * ("cannot affect row a second time"), so two verdicts on one candidate inside
 * a single scan must be settled here, before the statement is built.
 */
export function lastPerKey<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

/** What a rescore replaces. The user's own status and miss reason are theirs. */
const REJUDGED = {
  kind: sql`excluded.kind`,
  score: sql`excluded.score`,
  fit: sql`excluded.fit`,
  intent: sql`excluded.intent`,
  engagement: sql`excluded.engagement`,
  stage: sql`excluded.stage`,
  reason: sql`excluded.reason`,
  matchedPhrase: sql`excluded.matched_phrase`,
  scoredAt: sql`excluded.scored_at`,
};

/**
 * Writes the scan's qualified judgements. A lead the project already holds has
 * its judgement replaced, so a rescore after a profile edit or a comment thread
 * is visible, while the status and the miss reason the user set are preserved.
 */
export async function writeLeads(input: LeadRow[]): Promise<number> {
  const rows = lastPerKey(input, (row) => `${row.projectId} ${leadKey(row.postId, row.commentId)}`);
  const groups = [
    { rows: rows.filter((row) => row.commentId === null), onComment: false },
    { rows: rows.filter((row) => row.commentId !== null), onComment: true },
  ];
  let written = 0;
  for (const group of groups) {
    if (group.rows.length === 0) {
      continue;
    }
    const done = await db()
      .insert(leads)
      .values(group.rows.map((row) => ({ ...row, scoredAt: new Date() })))
      .onConflictDoUpdate({
        target: group.onComment ? [leads.projectId, leads.commentId] : [leads.projectId, leads.postId],
        targetWhere: group.onComment ? sql`comment_id is not null` : sql`comment_id is null`,
        set: REJUDGED,
      })
      .returning({ id: leads.id });
    written += done.length;
  }
  return written;
}

/**
 * The threads worth buying this scan: every post lead still in the feed whose
 * thread has never been read, or whose reply count has moved since it was,
 * best first. An unchanged thread has nothing new to name a competitor in, and
 * a thread under the minimum has too little to be worth its price.
 */
export async function threadsToRead(
  projectId: string,
  budget: number | null,
): Promise<StoredPost[]> {
  const query = db()
    .select({ post: redditPosts })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(leads.status, "new"),
        isNull(leads.commentId),
        sql`coalesce(${redditPosts.numComments}, 0) >= ${MIN_COMMENTS_FOR_THREAD}`,
        or(
          isNull(redditPosts.commentsObservedAt),
          sql`${redditPosts.numComments} is distinct from ${redditPosts.commentsReadCount}`,
        ),
      ),
    )
    .orderBy(desc(leads.score));
  const rows = budget === null ? await query : await query.limit(budget);
  return rows.map((row) => row.post);
}

/** One candidate a re-judgement no longer puts in the feed. */
export type LeadKeyRow = { postId: string; commentId: string | null };

/**
 * Takes back the leads whose latest verdict no longer routes anywhere. Only a
 * lead still sitting at `new` is withdrawn: once a person has hidden it, called
 * it a miss or marked it resolved, the row is their record and not the
 * scorer's. A withdrawn post appears in the held pile again, because a review
 * item is hidden only while a lead row for it exists.
 */
export async function demoteLeads(projectId: string, keys: LeadKeyRow[]): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }
  const done = await db()
    .delete(leads)
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(leads.status, "new"),
        or(
          ...keys.map((key) =>
            and(
              eq(leads.postId, key.postId),
              key.commentId === null ? isNull(leads.commentId) : eq(leads.commentId, key.commentId),
            ),
          ),
        ),
      ),
    )
    .returning({ id: leads.id });
  return done.length;
}
