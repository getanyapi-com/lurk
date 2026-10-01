import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * The time every pass here runs as, with this file's rows dated before it. A
 * retention pass reaches every row in the database, and the test database is
 * shared with every file running beside this one: on 2026-10-01 a pass on the
 * real clock took the 200-day-old post backfill.test.ts had just written, and
 * its next insert failed on the missing post. No other file dates a row this
 * early, so a pass as of 2010 can only take this file's. Not 2000, because
 * jobs.test.ts clears and claims the queue rows dated then.
 */
const NOW = new Date("2010-01-01T00:00:00Z");

/**
 * What the retention job is allowed to take away. A ranking thread is old by
 * definition, and a lead someone has not answered yet is still theirs, so a
 * post anything still points at outlives the window. Proven against a real
 * database, because the delete is the claim.
 */
describe.skipIf(!process.env.DATABASE_URL)("deleting expired posts", () => {
  async function fixture() {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { upsertPosts } = await import("@/lib/reddit/store");
    const { deleteExpiredPosts } = await import("@/lib/retention");
    const { inArray } = await import("drizzle-orm");

    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "HotelsAllow" })
      .returning();

    const longAgo = Math.floor(NOW.getTime() / 1000) - 600 * 24 * 3600;
    const [led, ranked, loose] = await upsertPosts(
      ["led", "ranked", "loose"].map((role) => ({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "philly",
        author: "asker",
        title: `An old thread the ${role} case points at`,
        body: "Every hotel we called says 21+.",
        permalink: `/r/philly/comments/${role}/old/`,
        createdUtc: longAgo,
      })),
    );

    await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: led.id, score: 80 });
    await db()
      .insert(schema.seoOpportunities)
      .values({ projectId: project.id, keyword: "hotels that take under 21", postId: ranked.id });

    return { db, schema, deleteExpiredPosts, inArray, project, led, ranked, loose };
  }

  it("keeps a post a lead or an SEO row still points at, and drops the rest", async () => {
    const { db, schema, deleteExpiredPosts, inArray, led, ranked, loose } = await fixture();

    await deleteExpiredPosts(NOW);

    const left = await db()
      .select({ id: schema.redditPosts.id })
      .from(schema.redditPosts)
      .where(inArray(schema.redditPosts.id, [led.id, ranked.id, loose.id]));
    expect(left.map((row) => row.id).sort()).toEqual([led.id, ranked.id].sort());
  });

  it("works through more expired posts than one batch holds", async () => {
    const { db, schema, deleteExpiredPosts, inArray, led, ranked, loose } = await fixture();
    const { upsertPosts } = await import("@/lib/reddit/store");
    const longAgo = Math.floor(NOW.getTime() / 1000) - 600 * 24 * 3600;
    const more = await upsertPosts(
      [1, 2, 3, 4].map((n) => ({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "philly",
        author: "asker",
        title: `Another old thread ${n}`,
        body: "Still nobody takes under 21.",
        permalink: `/r/philly/comments/more${n}/old/`,
        createdUtc: longAgo,
      })),
    );

    await deleteExpiredPosts(NOW, 2);

    const ids = [led.id, ranked.id, loose.id, ...more.map((post) => post.id)];
    const left = await db()
      .select({ id: schema.redditPosts.id })
      .from(schema.redditPosts)
      .where(inArray(schema.redditPosts.id, ids));
    expect(left.map((row) => row.id).sort()).toEqual([led.id, ranked.id].sort());
  });

  /**
   * What a model call cost is read long after the post it judged has expired,
   * so retention must not take llm_usage rows away. llm_usage points at a project
   * and never at a post, so deleting an expired post cannot cascade into it;
   * this is that fact, stated as a test rather than as a claim.
   */
  it("never takes away what a model call cost, however old its post is", async () => {
    const { db, schema, deleteExpiredPosts, inArray, project } = await fixture();
    await db()
      .insert(schema.llmUsage)
      .values({ projectId: project.id, purpose: "score", inputTokens: 10, outputTokens: 5 });

    await deleteExpiredPosts(NOW);

    const kept = await db()
      .select({ id: schema.llmUsage.id })
      .from(schema.llmUsage)
      .where(inArray(schema.llmUsage.projectId, [project.id]));
    expect(kept).toHaveLength(1);
  });
});

/**
 * The queue keeps a month of finished jobs, and for good the newest finished
 * job of each kind, since pages say when a project last ran something. A job
 * still waiting or running is never the retention job's to take.
 */
describe.skipIf(!process.env.DATABASE_URL)("pruning finished jobs", () => {
  it("drops month-old finished jobs but the newest of each kind, and never an unfinished one", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const { pruneFinishedJobs } = await import("@/lib/retention");

    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Queue" })
      .returning();
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 3600 * 1000);
    const ran = (kind: string, days: number, projectId: string | null = project.id) => ({
      kind,
      projectId,
      runAt: daysAgo(days),
      startedAt: daysAgo(days),
      finishedAt: daysAgo(days),
    });
    // No other test queues a kind of this name, so the instance-wide pair is
    // only ever this test's.
    const instanceKind = `prune_${randomUUID().slice(0, 8)}`;
    const rows = await db()
      .insert(schema.jobs)
      .values([
        ran("scan", 60),
        ran("scan", 50),
        ran("scan", 2),
        // Claimed long ago and never finished: a lease that ran out.
        { kind: "scan", projectId: project.id, runAt: daysAgo(40), startedAt: daysAgo(40) },
        { kind: "scan", projectId: project.id, runAt: daysAgo(-1) },
        ran("backfill", 200),
        ran("x_scan", 90),
        ran("x_scan", 40),
        ran(instanceKind, 45, null),
        ran(instanceKind, 35, null),
      ])
      .returning({ id: schema.jobs.id });
    const [old60, old50, recent, stuck, queued, backfill, x90, x40, instanceOld, instanceNewest] =
      rows.map((row) => row.id);

    await pruneFinishedJobs(NOW, 1);

    const left = await db()
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(inArray(schema.jobs.id, rows.map((row) => row.id)));
    expect(left.map((row) => row.id).sort()).toEqual(
      [recent, stuck, queued, backfill, x40, instanceNewest].sort(),
    );
    expect([old60, old50, x90, instanceOld].some((id) => left.some((row) => row.id === id))).toBe(false);

    await db().delete(schema.jobs).where(eq(schema.jobs.kind, instanceKind));
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});
