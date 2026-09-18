import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A comment lead is as old as its comment and lives at its comment. The app's
 * feed reads it that way, and the API and the alerts must agree with the feed.
 */
describe.skipIf(!process.env.DATABASE_URL)("a fresh comment on an old thread", () => {
  it("is listed by the API inside the window and links to the comment", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { leads, projects, redditComments, redditPosts, users } = await import("@/db/schema");
    const { listLeads } = await import("@/lib/leads");
    const { getApiLead, listApiLeads } = await import("@/lib/api/leadsRead");
    const { parseLeadQuery } = await import("@/lib/api/leadsQuery");
    const { newLeadsSince } = await import("@/lib/alerts/leads");
    const { eq } = await import("drizzle-orm");

    const id = randomUUID();
    const postUrl = "https://www.reddit.com/r/test/comments/old/";
    const commentUrl = "https://www.reddit.com/r/test/comments/old/comment/new/";
    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${id}` })
      .returning();
    try {
      const [project] = await db()
        .insert(projects)
        .values({ userId: user.id, name: "Audit" })
        .returning();
      await db().insert(redditPosts).values({
        id,
        subreddit: "test",
        title: "Older thread",
        url: postUrl,
        createdAt: new Date(Date.now() - 60 * DAY_MS),
      });
      await db().insert(redditComments).values({
        id,
        postId: id,
        body: "New buyer asking today",
        author: "buyer",
        permalink: commentUrl,
        createdAt: new Date(),
      });
      const [lead] = await db()
        .insert(leads)
        .values({ projectId: project.id, postId: id, commentId: id, score: 90 })
        .returning();

      expect(await listLeads(project.id, { status: "new", days: 30 })).toHaveLength(1);
      const listed = await listApiLeads(project.id, parseLeadQuery(new URLSearchParams()), 30);
      expect(listed.leads.map((one) => one.url)).toEqual([commentUrl]);
      expect((await getApiLead(user.id, lead.id))?.url).toBe(commentUrl);
      const alerted = await newLeadsSince(project.id, new Date(Date.now() - DAY_MS));
      expect(alerted.map((one) => one.url)).toEqual([commentUrl]);
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
      await db().delete(redditPosts).where(eq(redditPosts.id, id));
    }
  });
});
