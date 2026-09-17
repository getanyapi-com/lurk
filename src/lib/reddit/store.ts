import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { redditComments, redditPosts, searchRunPosts, searchRuns } from "@/db/schema";

export type StoredPost = typeof redditPosts.$inferSelect;
export type StoredComment = typeof redditComments.$inferSelect;

/** A post as any of the three Reddit listing shapes hands it to us. */
export type RawPost = {
  id: string;
  title: string;
  author?: string;
  body?: string;
  /** Search results carry the post's own text under this name. */
  selftext?: string;
  score?: number;
  numComments?: number;
  permalink?: string;
  url?: string;
  createdUtc?: number;
  subreddit: string;
  image?: string;
  /** Reddit archived the thread; absent means the source did not say. */
  isArchived?: boolean;
  /** A moderator locked the thread; absent means the source did not say. */
  isLocked?: boolean;
};

export type RawComment = {
  id: string;
  author?: string;
  body?: string;
  score?: number;
  url?: string;
  createdUtc?: number;
};

/** Reddit ids arrive prefixed on some shapes and bare on others; we store bare. */
export function bareId(id: string): string {
  return id.replace(/^t\d_/, "");
}

/** Seconds since the epoch, as Reddit sends every timestamp. */
function at(createdUtc: number | undefined): Date {
  return new Date((createdUtc ?? 0) * 1000);
}

/** An upstream link is sometimes a path and sometimes already absolute. */
function absoluteLink(link: string | undefined, fallback = ""): string {
  const value = link ?? "";
  if (value.startsWith("http")) {
    return value;
  }
  return value ? `https://www.reddit.com${value}` : fallback;
}

function postValues(post: RawPost) {
  const now = new Date();
  const body = post.body ?? post.selftext;
  return {
    id: bareId(post.id),
    subreddit: post.subreddit,
    author: post.author ?? null,
    title: post.title,
    body: body || null,
    url: absoluteLink(post.permalink, post.url ?? ""),
    score: post.score ?? null,
    numComments: post.numComments ?? null,
    imageUrl: post.image ?? null,
    isArchived: post.isArchived ?? null,
    isLocked: post.isLocked ?? null,
    createdAt: at(post.createdUtc),
    fetchedAt: now,
    bodyObservedAt: body ? now : null,
  };
}

/**
 * Writes the shared post rows. A later fetch may carry a body the listing did
 * not have, and a listing carrying an empty one is saying the same thing, so
 * neither ever overwrites a body we already hold. That also keeps the judged
 * text stable, which is what lets a stored verdict be reused. And
 * `bodyObservedAt` only moves on a fetch that really carried the text.
 *
 * The archive and lock flags go the other way. They are the thread's current
 * state rather than text we judged, so a fetch that carries one overwrites what
 * we hold, and only a fetch that carries nothing leaves it alone. Absent is
 * unknown, never false, which is why null loses to a value from either side.
 */
/**
 * A stored post turned back into the listing shape it came from, so a caller
 * holding it across a long run can write it again. A backfill keeps its posts
 * in memory while it judges a year of them, and the retention job can delete an
 * unreferenced one in that window, so the backfill re-persists what it found
 * before it points a lead or a source at it. The url is already absolute, so it
 * serves as the permalink `postValues` resolves.
 */
export function asRawPost(post: StoredPost): RawPost {
  return {
    id: post.id,
    subreddit: post.subreddit,
    author: post.author ?? undefined,
    title: post.title,
    body: post.body ?? undefined,
    url: post.url,
    permalink: post.url,
    score: post.score ?? undefined,
    numComments: post.numComments ?? undefined,
    image: post.imageUrl ?? undefined,
    isArchived: post.isArchived ?? undefined,
    isLocked: post.isLocked ?? undefined,
    createdUtc: Math.floor(post.createdAt.getTime() / 1000),
  };
}

/**
 * Stores a page of posts, and hands them back in the order they arrived in,
 * because a run's stored ranking is that order.
 *
 * The rows go to Postgres sorted by id. Two concurrent walks land on the same
 * post in different orders, and an upsert takes its index locks row by row in
 * the order the statement lists them: a sweep of 2026-09-10 deadlocked two of
 * its ten walks against each other and died. Sorting means every statement in
 * the process asks for the same rows in the same order, which is the ordering
 * that makes a deadlock impossible rather than unlikely.
 */
export async function upsertPosts(posts: RawPost[]): Promise<StoredPost[]> {
  if (posts.length === 0) {
    return [];
  }
  const values = posts.map(postValues);
  const order = new Map(values.map((row, index) => [row.id, index]));
  const sorted = [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stored = await db()
    .insert(redditPosts)
    .values(sorted)
    .onConflictDoUpdate({
      target: redditPosts.id,
      set: {
        title: sql`excluded.title`,
        body: sql`coalesce(excluded.body, ${redditPosts.body})`,
        score: sql`excluded.score`,
        numComments: sql`excluded.num_comments`,
        imageUrl: sql`coalesce(excluded.image_url, ${redditPosts.imageUrl})`,
        isArchived: sql`coalesce(excluded.is_archived, ${redditPosts.isArchived})`,
        isLocked: sql`coalesce(excluded.is_locked, ${redditPosts.isLocked})`,
        fetchedAt: sql`excluded.fetched_at`,
        bodyObservedAt: sql`coalesce(excluded.body_observed_at, ${redditPosts.bodyObservedAt})`,
      },
    })
    .returning();
  return stored.sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}

/** Records which posts a run produced, in the order the upstream ranked them. */
export async function linkRunPosts(searchRunId: string, postIds: string[]) {
  if (postIds.length === 0) {
    return;
  }
  await db()
    .insert(searchRunPosts)
    .values(postIds.map((postId, index) => ({ searchRunId, postId, position: index })))
    .onConflictDoNothing();
}

/** The posts one stored run produced, in its original order. */
export async function postsOfRun(searchRunId: string): Promise<StoredPost[]> {
  const rows = await db()
    .select({ post: redditPosts })
    .from(searchRunPosts)
    .innerJoin(redditPosts, eq(redditPosts.id, searchRunPosts.postId))
    .where(eq(searchRunPosts.searchRunId, searchRunId))
    .orderBy(asc(searchRunPosts.position));
  return rows.map((row) => row.post);
}

/** The cursor a stored run ended on, so a reused page continues the same walk. */
export async function cursorOfRun(searchRunId: string): Promise<string | null> {
  const rows = await db()
    .select({ nextCursor: searchRuns.nextCursor })
    .from(searchRuns)
    .where(eq(searchRuns.id, searchRunId));
  return rows[0]?.nextCursor ?? null;
}

/**
 * Writes a thread's comments and stamps the post with when its thread was last
 * really read. An empty thread is an observation too, which is what lets a
 * later scan tell "nobody replied" from "we never looked".
 */
export async function upsertComments(
  postId: string,
  comments: RawComment[],
): Promise<StoredComment[]> {
  await db()
    .update(redditPosts)
    .set({ commentsObservedAt: new Date() })
    .where(eq(redditPosts.id, postId));
  if (comments.length === 0) {
    return [];
  }
  return db()
    .insert(redditComments)
    .values(
      comments.map((comment) => ({
        id: bareId(comment.id),
        postId,
        author: comment.author ?? null,
        body: comment.body ?? null,
        score: comment.score ?? null,
        permalink: absoluteLink(comment.url) || null,
        createdAt: at(comment.createdUtc),
        fetchedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: redditComments.id,
      set: {
        body: sql`excluded.body`,
        score: sql`excluded.score`,
        permalink: sql`coalesce(excluded.permalink, ${redditComments.permalink})`,
      },
    })
    .returning();
}

export async function commentsOfPost(postId: string): Promise<StoredComment[]> {
  return db().select().from(redditComments).where(eq(redditComments.postId, postId));
}

export async function postsByIds(ids: string[]): Promise<StoredPost[]> {
  if (ids.length === 0) {
    return [];
  }
  return db().select().from(redditPosts).where(inArray(redditPosts.id, ids));
}
