import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { StoredPost } from "@/lib/reddit/store";
import { threadPolicyFor } from "@/lib/settings";
import type { ThreadPolicy, ThreadPolicySettings } from "@/lib/settings/types";

/**
 * What a scan and an SEO refresh pay for in a comment thread, under a policy.
 * The query is the thing worth pinning: which lead's thread is bought, how old
 * a post may be to be bought again, and how many are bought at once.
 */

const hasDatabase = !!process.env.DATABASE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A policy the settings module builds, from the connected preset's values. */
function policy(patch: Partial<ThreadPolicySettings> = {}): ThreadPolicy {
  return threadPolicyFor({
    replyWindowDays: 3,
    minReplies: 3,
    threadsPerScan: null,
    readOldThreadsOnce: true,
    readSeoReplies: true,
    ...patch,
  });
}

describe.skipIf(!hasDatabase)("threadsToRead against a database", () => {
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let threadsToRead: typeof import("@/lib/scan/leads").threadsToRead;
  let eq: typeof import("drizzle-orm").eq;

  beforeEach(async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ threadsToRead } = await import("@/lib/scan/leads"));
    ({ eq } = await import("drizzle-orm"));
  });

  async function project(): Promise<string> {
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [row] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft", solution: "A form builder." })
      .returning();
    return row.id;
  }

  /** One post lead in the feed, on a post of the given age and reply count. */
  async function lead(
    projectId: string,
    { ageDays = 0, replies = 5, score = 60 } = {},
  ): Promise<string> {
    const [post] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        title: "Form question",
        url: `https://www.reddit.com/r/SaaS/comments/${randomUUID().slice(0, 6)}/form/`,
        numComments: replies,
        createdAt: new Date(Date.now() - ageDays * DAY_MS),
      })
      .returning();
    await db()
      .insert(schema.leads)
      .values({ projectId, postId: post.id, score, kind: "buyer" });
    return post.id;
  }

  /** What reading a thread records: when it was read and at what reply count. */
  async function markRead(postId: string, replies: number): Promise<void> {
    await db()
      .update(schema.redditPosts)
      .set({ commentsObservedAt: new Date(), commentsReadCount: replies })
      .where(eq(schema.redditPosts.id, postId));
  }

  async function setReplies(postId: string, replies: number): Promise<void> {
    await db()
      .update(schema.redditPosts)
      .set({ numComments: replies })
      .where(eq(schema.redditPosts.id, postId));
  }

  const ids = async (projectId: string, p: ThreadPolicy): Promise<string[]> =>
    (await threadsToRead(projectId, p)).map((post) => post.id);

  it("buys a fresh thread once, and again only when its reply count moves", async () => {
    const projectId = await project();
    const postId = await lead(projectId, { ageDays: 0, replies: 5 });

    expect(await ids(projectId, policy())).toEqual([postId]);
    await markRead(postId, 5);
    expect(await ids(projectId, policy())).toEqual([]);
    await setReplies(postId, 9);
    expect(await ids(projectId, policy())).toEqual([postId]);
  });

  it("never buys a thread older than the window when old threads are not read", async () => {
    const projectId = await project();
    const postId = await lead(projectId, { ageDays: 10, replies: 8 });

    expect(await ids(projectId, policy({ readOldThreadsOnce: false }))).toEqual([]);
    await setReplies(postId, 20);
    expect(await ids(projectId, policy({ readOldThreadsOnce: false }))).toEqual([]);
  });

  it("buys an old thread once for its competitors, never again when its count moves", async () => {
    const projectId = await project();
    const postId = await lead(projectId, { ageDays: 10, replies: 8 });

    expect(await ids(projectId, policy())).toEqual([postId]);
    await markRead(postId, 8);
    await setReplies(postId, 40);
    expect(await ids(projectId, policy())).toEqual([]);
  });

  it("never buys a thread under the policy's minimum replies", async () => {
    const projectId = await project();
    await lead(projectId, { replies: 2 });

    expect(await ids(projectId, policy())).toEqual([]);
    expect(await ids(projectId, policy({ minReplies: 2 }))).toHaveLength(1);
  });

  it("buys the best scoring threads up to the cap, and every one with no cap", async () => {
    const projectId = await project();
    const best = await lead(projectId, { score: 90 });
    const middle = await lead(projectId, { score: 70 });
    await lead(projectId, { score: 50 });

    expect(await ids(projectId, policy({ threadsPerScan: 2 }))).toEqual([best, middle]);
    expect(await ids(projectId, policy())).toHaveLength(3);
  });
});

describe("repliesWorthReading", () => {
  /** A ranked thread as the SEO refresh holds it, never read before. */
  function post(patch: Partial<StoredPost> = {}): StoredPost {
    return {
      id: "p1",
      subreddit: "SaaS",
      author: "asker",
      title: "Best form builder",
      body: null,
      url: "https://www.reddit.com/r/SaaS/comments/abc123/form/",
      score: 10,
      numComments: 8,
      imageUrl: null,
      isArchived: null,
      isLocked: null,
      createdAt: new Date("2020-01-01T00:00:00Z"),
      fetchedAt: new Date(),
      bodyObservedAt: null,
      commentsObservedAt: null,
      commentsReadCount: null,
      raw: null,
      ...patch,
    };
  }

  it("buys nothing when the policy reads no SEO replies", async () => {
    const { repliesWorthReading } = await import("@/lib/seo/refresh");
    expect(repliesWorthReading(policy({ readSeoReplies: false }), post())).toBe(false);
  });

  it("buys an unread thread over the minimum however old the post is", async () => {
    const { repliesWorthReading } = await import("@/lib/seo/refresh");
    expect(repliesWorthReading(policy(), post())).toBe(true);
    expect(repliesWorthReading(policy(), post({ numComments: 2 }))).toBe(false);
  });

  it("buys a read thread again only when its reply count has moved", async () => {
    const { repliesWorthReading } = await import("@/lib/seo/refresh");
    const read = { commentsObservedAt: new Date(), commentsReadCount: 8 };
    expect(repliesWorthReading(policy(), post(read))).toBe(false);
    expect(repliesWorthReading(policy(), post({ ...read, numComments: 12 }))).toBe(true);
  });
});
