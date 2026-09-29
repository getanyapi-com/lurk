import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { xAuthors, xPosts, xSearchRunPosts } from "@/db/schema";
import type { XAuthor, XPost } from "./map";

/** The shared X post store. One row per post for every tenant, as reddit/store.ts does for Reddit. */

export type StoredXPost = typeof xPosts.$inferSelect;
/** The reply that led lurk to a post whose own words the search could not match, and the searched words it used. */
export type XVia = { tweetId: string; author: string; phrase: string | null };
export type StoredXAuthor = typeof xAuthors.$inferSelect;

function postValues(post: XPost) {
  return { ...post, fetchedAt: new Date() };
}

/**
 * Stores a page of posts and hands them back in the order they arrived in.
 * Rows go to Postgres sorted by id, the same deadlock guard as Reddit's
 * upsertPosts: two concurrent walks meeting one post take its locks in the same
 * order. Counts are refreshed; a field one SKU leaves out (twitter.tweet has no
 * follower count) never erases what another SKU gave.
 */
export async function upsertXPosts(posts: XPost[]): Promise<StoredXPost[]> {
  if (posts.length === 0) {
    return [];
  }
  const unique = [...new Map(posts.map((post) => [post.id, postValues(post)])).values()];
  const order = new Map(posts.map((post, index) => [post.id, index]));
  const sorted = [...unique].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stored = await db()
    .insert(xPosts)
    .values(sorted)
    .onConflictDoUpdate({
      target: xPosts.id,
      set: {
        text: sql`excluded.text`,
        lang: sql`coalesce(excluded.lang, ${xPosts.lang})`,
        authorName: sql`coalesce(excluded.author_name, ${xPosts.authorName})`,
        authorId: sql`coalesce(excluded.author_id, ${xPosts.authorId})`,
        authorImage: sql`coalesce(excluded.author_image, ${xPosts.authorImage})`,
        authorFollowers: sql`coalesce(excluded.author_followers, ${xPosts.authorFollowers})`,
        authorVerified: sql`coalesce(excluded.author_verified, ${xPosts.authorVerified})`,
        inReplyToId: sql`coalesce(excluded.in_reply_to_id, ${xPosts.inReplyToId})`,
        conversationId: sql`coalesce(excluded.conversation_id, ${xPosts.conversationId})`,
        likeCount: sql`coalesce(excluded.like_count, ${xPosts.likeCount})`,
        replyCount: sql`coalesce(excluded.reply_count, ${xPosts.replyCount})`,
        retweetCount: sql`coalesce(excluded.retweet_count, ${xPosts.retweetCount})`,
        quoteCount: sql`coalesce(excluded.quote_count, ${xPosts.quoteCount})`,
        viewCount: sql`coalesce(excluded.view_count, ${xPosts.viewCount})`,
        bookmarkCount: sql`coalesce(excluded.bookmark_count, ${xPosts.bookmarkCount})`,
        mediaCount: sql`coalesce(excluded.media_count, ${xPosts.mediaCount})`,
        unavailableAt: sql`null`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    })
    .returning();
  return stored.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Records which posts a run produced, in the order the upstream ranked them. */
export async function linkXRunPosts(searchRunId: string, tweetIds: string[]) {
  if (tweetIds.length === 0) {
    return;
  }
  await db()
    .insert(xSearchRunPosts)
    .values([...new Set(tweetIds)].map((tweetId, position) => ({ searchRunId, tweetId, position })))
    .onConflictDoNothing();
}

/** The posts one stored run produced, in its original order. */
export async function xPostsOfRun(searchRunId: string): Promise<StoredXPost[]> {
  const rows = await db()
    .select({ post: xPosts })
    .from(xSearchRunPosts)
    .innerJoin(xPosts, eq(xPosts.id, xSearchRunPosts.tweetId))
    .where(eq(xSearchRunPosts.searchRunId, searchRunId))
    .orderBy(asc(xSearchRunPosts.position));
  return rows.map((row) => row.post);
}

export async function xPostsById(ids: string[]): Promise<Map<string, StoredXPost>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db().select().from(xPosts).where(inArray(xPosts.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row]));
}

/** A lookup that came back not found: deleted, protected or withheld. The tab stops showing it. */
export async function markXPostUnavailable(id: string) {
  await db().update(xPosts).set({ unavailableAt: new Date() }).where(eq(xPosts.id, id));
}

export async function upsertXAuthor(author: XAuthor): Promise<StoredXAuthor> {
  const values = { ...author, fetchedAt: new Date() };
  const [stored] = await db()
    .insert(xAuthors)
    .values(values)
    .onConflictDoUpdate({ target: xAuthors.username, set: values })
    .returning();
  return stored;
}

export async function xAuthorByUsername(username: string): Promise<StoredXAuthor | null> {
  const [row] = await db()
    .select()
    .from(xAuthors)
    .where(eq(xAuthors.username, username.toLowerCase()))
    .limit(1);
  return row ?? null;
}
