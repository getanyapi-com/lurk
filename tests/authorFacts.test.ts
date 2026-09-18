import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * The author facts a lead card reads: what the profile call already returns,
 * stored beside the avatar and handed back by the feed query. Database-backed,
 * because the storing and the join are both SQL.
 */

const hasDatabase = !!process.env.DATABASE_URL;

/** The profile SKU reports `createdUtc` in Unix seconds. */
const CREATED_UTC = 1_500_000_000;

describe.skipIf(!hasDatabase)("author facts from the profile call", () => {
  async function context(username: string) {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft" })
      .returning();
    const funded = {
      funding: "wallet:test" as const,
      client: {
        // `reddit.avatar` is asked for by slug: see fetchAuthorProfile.
        run: async () => ({
          output: {
            found: true,
            data: {
              username,
              avatarUrl: "https://example.com/a.png",
              karma: 4321,
              createdUtc: CREATED_UTC,
            },
          },
          costUsd: 0,
        }),
      },
      call: async <T>(fn: () => Promise<T>) => ({ result: await fn(), requestId: null }),
    };
    // The stub client only has the one method this call reaches.
    return { db, schema, project, ctx: { projectId: project.id, funded, maxAgeMs: 0 } as never };
  }

  it("stores the karma and the account age the profile call already paid for", async () => {
    const username = `u${randomUUID().slice(0, 8)}`;
    const { db, schema, ctx } = await context(username);
    const { fetchAuthorProfile } = await import("@/lib/reddit/skus");
    const { eq } = await import("drizzle-orm");

    const result = await fetchAuthorProfile(ctx, username, 0);
    expect(result.value?.karma).toBe(4321);

    const rows = await db()
      .select()
      .from(schema.redditAuthors)
      .where(eq(schema.redditAuthors.username, username.toLowerCase()));
    expect(rows[0].karma).toBe(4321);
    expect(rows[0].accountCreatedAt).toEqual(new Date(CREATED_UTC * 1000));
  });

  it("hands the author's karma to the feed", async () => {
    const username = `u${randomUUID().slice(0, 8)}`;
    const { db, schema, project, ctx } = await context(username);
    const { fetchAuthorProfile } = await import("@/lib/reddit/skus");
    const { listLeads } = await import("@/lib/leads");
    await fetchAuthorProfile(ctx, username, 0);

    const [post] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: username,
        title: "Form question",
        url: "https://www.reddit.com/r/SaaS/comments/x/form/",
        createdAt: new Date(),
      })
      .returning();
    await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: post.id, score: 60, stage: "comparing" });

    const shown = await listLeads(project.id, { status: "new", days: "all" });
    expect(shown.map((lead) => lead.authorKarma)).toEqual([4321]);
    expect(shown[0].authorCreatedAt).toEqual(new Date(CREATED_UTC * 1000));
  });
});
