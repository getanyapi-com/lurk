import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetEveryProjectFeed } from "@/lib/projectFeedCache";

/**
 * What the leads page reads against a real database, and what it does not read
 * twice. The holder itself is pinned in projectFeedCache.test.ts; this proves
 * the page's own reads go through it, and that the writers behind them drop it.
 */

const hasDatabase = !!process.env.DATABASE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!hasDatabase)("the leads page read", () => {
  beforeEach(() => {
    forgetEveryProjectFeed();
  });

  async function fixture() {
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
    const [post] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: "Form question",
        url: "https://www.reddit.com/r/SaaS/comments/x/form/",
        createdAt: new Date(Date.now() - DAY_MS),
      })
      .returning();
    return { db, schema, project, post };
  }

  /** Another post in the window, written behind the page's back. */
  async function anotherLead(
    db: Awaited<ReturnType<typeof fixture>>["db"],
    schema: Awaited<ReturnType<typeof fixture>>["schema"],
    projectId: string,
  ) {
    const [post] = await db()
      .insert(schema.redditPosts)
      .values({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: "Another form question",
        url: "https://www.reddit.com/r/SaaS/comments/y/form/",
        createdAt: new Date(Date.now() - DAY_MS),
      })
      .returning();
    await db()
      .insert(schema.leads)
      .values({ projectId, postId: post.id, score: 60, stage: "comparing" });
  }

  const FILTER = { status: "new", days: 30 } as const;

  it("answers a second read of the same filter without reading again", async () => {
    const { db, schema, project, post } = await fixture();
    const { feedPage } = await import("@/lib/feedPage");
    await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: post.id, score: 60, stage: "comparing" });

    const first = await feedPage(project.id, FILTER);
    await anotherLead(db, schema, project.id);

    // The same object, not an equal one: nothing was read the second time.
    expect(await feedPage(project.id, FILTER)).toBe(first);
    expect(first.rows).toHaveLength(1);
    expect(first.total).toBe(1);
  });

  it("reads again when the filter moves", async () => {
    const { db, schema, project, post } = await fixture();
    const { feedPage } = await import("@/lib/feedPage");
    await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: post.id, score: 60, stage: "comparing" });

    const shown = await feedPage(project.id, FILTER);
    const hidden = await feedPage(project.id, { status: "hidden", days: 30 });
    expect(shown.rows).toHaveLength(1);
    expect(hidden.rows).toHaveLength(0);
  });

  it("reads one page of leads and counts the rest", async () => {
    const { db, schema, project } = await fixture();
    const { FEED_PAGE_SIZE } = await import("@/lib/feed");
    const { feedPage } = await import("@/lib/feedPage");
    for (let made = 0; made < FEED_PAGE_SIZE + 3; made += 1) {
      await anotherLead(db, schema, project.id);
    }

    const page = await feedPage(project.id, FILTER);
    expect(page.rows).toHaveLength(FEED_PAGE_SIZE);
    expect(page.total).toBe(FEED_PAGE_SIZE + 3);
    // The strip over the list is a calendar of everyone, not of one page.
    expect(page.faces).toHaveLength(FEED_PAGE_SIZE + 3);
  });

  it("reads again after a scan writes a lead", async () => {
    const { project, post } = await fixture();
    const { feedPage } = await import("@/lib/feedPage");
    const { writeLeads } = await import("@/lib/scan/leads");
    expect((await feedPage(project.id, FILTER)).rows).toHaveLength(0);

    await writeLeads([
      {
        projectId: project.id,
        postId: post.id,
        commentId: null,
        kind: "buyer",
        score: 60,
        fit: 3,
        intent: 3,
        engagement: 2,
        stage: "comparing",
        reason: "asked for exactly this",
        matchedPhrase: "prefilled forms",
      },
    ]);

    expect((await feedPage(project.id, FILTER)).rows).toHaveLength(1);
  });

  it("reads again after a lead's status changes", async () => {
    const { db, schema, project, post } = await fixture();
    const { feedPage } = await import("@/lib/feedPage");
    const { setLeadStatus } = await import("@/lib/leads");
    const [lead] = await db()
      .insert(schema.leads)
      .values({ projectId: project.id, postId: post.id, score: 60, stage: "comparing" })
      .returning();
    expect((await feedPage(project.id, FILTER)).rows).toHaveLength(1);

    await setLeadStatus(project.id, lead.id, "hidden", null);

    expect((await feedPage(project.id, FILTER)).rows).toHaveLength(0);
  });

  /**
   * The scan report over the feed counts candidates, so a scan recording what
   * it found while someone watches their feed has to move that number.
   */
  it("reads again after a scan records a candidate", async () => {
    const { project, post } = await fixture();
    const { feedPage } = await import("@/lib/feedPage");
    const { recordSources } = await import("@/lib/scan/sources");
    expect((await feedPage(project.id, FILTER)).report.candidates).toBe(0);

    await recordSources(project.id, [
      { postId: post.id, sources: [{ kind: "search", key: "prefilled forms", rows: [] }] },
    ]);

    expect((await feedPage(project.id, FILTER)).report.candidates).toBe(1);
  });
});
