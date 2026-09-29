import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * lurk keeps no archive of X. A post goes thirty days after it was both
 * written and fetched, whether or not a lead points at it (the tab shows a
 * week), and its evaluations and leads go with it. Search runs stay, as
 * Reddit's do: they hold a query and a cost, no X content.
 */
describe.skipIf(!process.env.DATABASE_URL)("deleting expired X data", () => {
  it("drops old posts with their leads, keeps fresh ones and parents bought lately, and leaves every run", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { inArray } = await import("drizzle-orm");
    const { deleteExpiredXData } = await import("@/lib/x/retention");

    const [user] = await db().insert(schema.users).values({ clerkUserId: `test_${randomUUID()}` }).returning();
    const [project] = await db().insert(schema.projects).values({ userId: user.id, name: "Retention" }).returning();
    const old = new Date(Date.now() - 40 * 24 * 3_600_000);
    const suffix = Date.now();
    const ids = { stale: `8${suffix}1`, fresh: `8${suffix}2`, parent: `8${suffix}3` };
    const base = { text: "alternative to calendly?", authorUsername: "someone" };
    await db()
      .insert(schema.xPosts)
      .values([
        { ...base, id: ids.stale, createdAt: old, fetchedAt: old },
        { ...base, id: ids.fresh, createdAt: new Date(), fetchedAt: new Date() },
        { ...base, id: ids.parent, createdAt: old, fetchedAt: new Date() },
      ]);
    await db().insert(schema.xLeads).values({ projectId: project.id, tweetId: ids.stale, score: 80, authorUsername: "someone" });
    const xRun = randomUUID();
    const redditRun = randomUUID();
    await db()
      .insert(schema.searchRuns)
      .values([
        { id: xRun, kind: "x_search", sku: "twitter.search", normalizedQuery: "q", fundedBy: "house", fetchedAt: old },
        { id: redditRun, kind: "keyword", sku: "reddit.search", normalizedQuery: "q", fundedBy: "house", fetchedAt: old },
      ]);
    await db().insert(schema.usageLedger).values({ projectId: project.id, sku: "twitter.search", searchRunId: xRun });

    await deleteExpiredXData();

    const posts = await db().select({ id: schema.xPosts.id }).from(schema.xPosts).where(inArray(schema.xPosts.id, Object.values(ids)));
    expect(posts.map((row) => row.id).sort()).toEqual([ids.fresh, ids.parent].sort());
    expect(await db().select().from(schema.xLeads).where(inArray(schema.xLeads.tweetId, [ids.stale]))).toHaveLength(0);
    const runs = await db().select({ id: schema.searchRuns.id }).from(schema.searchRuns).where(inArray(schema.searchRuns.id, [xRun, redditRun]));
    expect(runs.map((row) => row.id).sort()).toEqual([xRun, redditRun].sort());
    const [line] = await db().select().from(schema.usageLedger).where(inArray(schema.usageLedger.projectId, [project.id]));
    expect(line.searchRunId).toBe(xRun);
    await db().delete(schema.usageLedger).where(inArray(schema.usageLedger.projectId, [project.id]));
    await db().delete(schema.searchRuns).where(inArray(schema.searchRuns.id, [xRun, redditRun]));
  });
});
