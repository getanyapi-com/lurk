import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditPosts } from "@/db/schema";
import { forgetProjectFeed } from "@/lib/projectFeedCache";
import type { StoredPost } from "@/lib/reddit/store";
import type { ThreadPolicy } from "@/lib/settings/types";
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
  forgetProjectFeed(new Set(rows.map((row) => row.projectId)));
  return written;
}

/**
 * The threads worth reading this scan, best score first: every post lead still
 * in the feed whose post carries at least the policy's minimum replies and
 * whose thread this project has never read, or whose reply count has moved
 * since it did. An unchanged thread has nothing new to name a competitor in,
 * and a thread under the minimum has too little to be worth its price.
 *
 * The question is asked of the lead, not of the shared post. Another project,
 * or the SEO refresh, buying the thread leaves its comments stored for everyone
 * but judges them for nobody else, so that purchase never takes a thread off
 * this project's list; `readLeadThreads` reads it from the store for nothing.
 *
 * Age decides which of those two the policy still pays for. A post inside the
 * reply window is read whenever its count moves, because that is where the
 * replies still arrive. A post older than the window is read only once, and
 * only when the policy reads old threads at all: for the competitors already
 * named in it, never again for a count that moved. `threadsPerScan` caps how
 * many are read; null reads every one that qualifies.
 */
export async function threadsToRead(
  projectId: string,
  policy: ThreadPolicy,
  now: Date = new Date(),
): Promise<StoredPost[]> {
  const fresh = gte(redditPosts.createdAt, policy.freshSince(now));
  const query = db()
    .select({ post: redditPosts })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(leads.status, "new"),
        isNull(leads.commentId),
        sql`coalesce(${redditPosts.numComments}, 0) >= ${policy.minReplies}`,
        policy.readOldThreadsOnce ? or(fresh, isNull(leads.threadReadCount)) : fresh,
        or(
          isNull(leads.threadReadCount),
          sql`coalesce(${redditPosts.numComments}, 0) <> ${leads.threadReadCount}`,
        ),
      ),
    )
    .orderBy(desc(leads.score));
  const rows =
    policy.threadsPerScan === null ? await query : await query.limit(policy.threadsPerScan);
  return rows.map((row) => row.post);
}

/**
 * Records that this project has judged these threads at the reply counts they
 * were read at. Written after the comment leads are, so a scan that dies in
 * between reads the thread again instead of losing the people in it.
 */
export async function markThreadsRead(projectId: string, posts: StoredPost[]): Promise<void> {
  for (const post of posts) {
    await db()
      .update(leads)
      .set({ threadReadCount: post.numComments ?? 0 })
      .where(
        and(eq(leads.projectId, projectId), eq(leads.postId, post.id), isNull(leads.commentId)),
      );
  }
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
  forgetProjectFeed(projectId);
  return done.length;
}
