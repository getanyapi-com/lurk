import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * What the feed decides when it is read, rather than when the scan ran: the
 * project's own minimum score, and how old a comment lead is. Both are answered
 * against a real database, because both are SQL.
 */

const hasDatabase = !!process.env.DATABASE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!hasDatabase)("the feed at read time", () => {
  async function fixture(threshold: number | null) {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft", scoreThreshold: threshold })
      .returning();
    const [post] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: "Form question",
        url: "https://www.reddit.com/r/SaaS/comments/x/form/",
        createdAt: new Date(Date.now() - 10 * DAY_MS),
      })
      .returning();
    return { db, schema, project, post };
  }

  /** Three leads on three threads of one project, best score first. */
  async function threeLeads(
    db: Awaited<ReturnType<typeof fixture>>["db"],
    schema: Awaited<ReturnType<typeof fixture>>["schema"],
    projectId: string,
    firstPostId: string,
  ) {
    const rows = [{ postId: firstPostId, score: 70 }];
    for (const score of [60, 50]) {
      const [extra] = await db()
        .insert(schema.redditPosts)
        .values({
          id: `p${randomUUID().slice(0, 8)}`,
          subreddit: "SaaS",
          author: "asker",
          title: `Form question ${score}`,
          url: `https://www.reddit.com/r/SaaS/comments/${score}/form/`,
          createdAt: new Date(Date.now() - 10 * DAY_MS),
        })
        .returning();
      rows.push({ postId: extra.id, score });
    }
    return db()
      .insert(schema.leads)
      .values(rows.map((row) => ({ projectId, ...row })))
      .returning();
  }

  it("hides a lead under the project's minimum score and shows it when that moves", async () => {
    const { db, schema, project, post } = await fixture(70);
    const { listLeads } = await import("@/lib/leads");
    const { eq } = await import("drizzle-orm");
    await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: post.id, score: 60, stage: "comparing" });

    expect(await listLeads(project.id, { status: "new", days: 30 })).toHaveLength(0);
    await db()
      .update(schema.projects)
      .set({ scoreThreshold: 50 })
      .where(eq(schema.projects.id, project.id));
    expect(await listLeads(project.id, { status: "new", days: 30 })).toHaveLength(1);
  });

  it("shows a context lead the score floor would hide, because it is not a buyer", async () => {
    const { db, schema, project, post } = await fixture(70);
    const { listLeads } = await import("@/lib/leads");
    await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: post.id, score: 40, stage: "none", kind: "context" });

    const shown = await listLeads(project.id, { status: "new", days: "all" });
    expect(shown.map((lead) => lead.kind)).toEqual(["context"]);
  });

  it("dates a comment lead by the comment, not by the thread it was left in", async () => {
    const { db, schema, project, post } = await fixture(null);
    const { listLeads } = await import("@/lib/leads");
    const [comment] = await db()
      .insert(schema.redditComments)
      .values({
        id: `c${randomUUID().slice(0, 8)}`,
        postId: post.id,
        author: "buyer",
        body: "I need the same thing for my own signup form.",
        permalink: "https://www.reddit.com/r/SaaS/comments/x/form/c1/",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      })
      .returning();
    await db()
      .insert(schema.leads)
      .values([
        { projectId: project.id, postId: post.id, score: 60, stage: "comparing" },
        {
          projectId: project.id,
          postId: post.id,
          commentId: comment.id,
          score: 60,
          stage: "comparing",
        },
      ]);

    const today = await listLeads(project.id, { status: "new", days: 1 });
    expect(today.map((lead) => lead.commentId)).toEqual([comment.id]);
    expect(await listLeads(project.id, { status: "new", days: 30 })).toHaveLength(2);
  });

  it("narrows the feed to the leads one Insights theme holds", async () => {
    const { db, schema, project, post } = await fixture(null);
    const { listLeads } = await import("@/lib/leads");
    const [other] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: "Another form question",
        url: "https://www.reddit.com/r/SaaS/comments/z/form/",
        createdAt: new Date(Date.now() - 2 * DAY_MS),
      })
      .returning();
    const held = await db()
      .insert(schema.leads)
      .values([
        { projectId: project.id, postId: post.id, score: 60, stage: "comparing" },
        { projectId: project.id, postId: other.id, score: 60, stage: "comparing" },
      ])
      .returning();
    const [theme] = await db()
      .insert(schema.painThemes)
      .values({ projectId: project.id, label: "prefilled forms", leadIds: [held[0].id] })
      .returning();

    const themed = await listLeads(project.id, {
      status: "new",
      days: "all",
      theme: theme.id,
    });
    expect(themed.map((lead) => lead.id)).toEqual([held[0].id]);
    expect(await listLeads(project.id, { status: "new", days: "all" })).toHaveLength(2);
  });

  it("shows what the day windows cut off once the window is all time", async () => {
    const { db, schema, project, post } = await fixture(null);
    const { listLeads } = await import("@/lib/leads");
    const [old] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: "Form question from last year",
        url: "https://www.reddit.com/r/SaaS/comments/y/form/",
        createdAt: new Date(Date.now() - 300 * DAY_MS),
      })
      .returning();
    await db()
      .insert(schema.leads)
      .values([
        { projectId: project.id, postId: post.id, score: 60, stage: "comparing" },
        { projectId: project.id, postId: old.id, score: 60, stage: "comparing" },
      ]);

    expect(await listLeads(project.id, { status: "new", days: 30 })).toHaveLength(1);
    const everything = await listLeads(project.id, { status: "new", days: "all" });
    expect(everything.map((lead) => lead.postId).sort()).toEqual([old.id, post.id].sort());
  });

  /**
   * The list column reads one page and counts the rest. Before this, arriving
   * on a project with a backfill behind it read and drew every lead it had.
   */
  it("reads one page of the feed in its own order, and counts the whole window", async () => {
    const { db, schema, project, post } = await fixture(null);
    const { countLeads, findLead, listLeads } = await import("@/lib/leads");
    const written = await threeLeads(db, schema, project.id, post.id);
    const best = written.sort((a, b) => b.score - a.score);

    const first = await listLeads(project.id, { status: "new", days: "all" }, { limit: 2, offset: 0 });
    const second = await listLeads(project.id, { status: "new", days: "all" }, { limit: 2, offset: 2 });

    expect(first.map((lead) => lead.id)).toEqual([best[0].id, best[1].id]);
    expect(second.map((lead) => lead.id)).toEqual([best[2].id]);
    expect(await countLeads(project.id, { status: "new", days: "all" })).toBe(3);
    // The pane opens on a lead no page of the list is holding.
    expect((await findLead(project.id, best[2].id))?.id).toBe(best[2].id);
  });

  /** Every face the window holds, however few of its leads have been read. */
  it("strips the faces of the whole window, not of the page", async () => {
    const { db, schema, project, post } = await fixture(null);
    const { listLeadFaces } = await import("@/lib/leads");
    await threeLeads(db, schema, project.id, post.id);

    const faces = await listLeadFaces(project.id, { status: "new", days: "all" });

    expect(faces).toHaveLength(3);
    expect(faces[0].author).toBe("asker");
    expect(faces[0].subreddit).toBe("SaaS");
    expect(faces[0].at).toBeInstanceOf(Date);
  });
});

/**
 * The day a column in the people strip puts in the URL, read back. It reaches
 * a SQL bound, so a value that is not one of ours has to become no filter at
 * all rather than a date JavaScript was willing to invent.
 */
describe("the day one strip column filters to", () => {
  it("takes a real calendar day and drops anything else", async () => {
    const { feedFilter } = await import("@/lib/feed");

    expect(feedFilter({ day: "2026-09-14" }).day).toBe("2026-09-14");
    // February the thirty-first parses, as the third of March. It is not a day.
    expect(feedFilter({ day: "2026-02-31" }).day).toBeUndefined();
    expect(feedFilter({ day: "yesterday" }).day).toBeUndefined();
    expect(feedFilter({ day: "2026-09-14'; drop table leads--" }).day).toBeUndefined();
    expect(feedFilter({}).day).toBeUndefined();
  });

  it("keeps the window the day was picked from, so it can be handed back", async () => {
    const { feedFilter } = await import("@/lib/feed");

    expect(feedFilter({ days: "7", day: "2026-09-14" })).toMatchObject({
      days: 7,
      day: "2026-09-14",
    });
  });
});
