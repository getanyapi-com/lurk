import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Judgement } from "@/lib/scan/judgement";

/**
 * What the two scan writers do with a candidate that reached them twice.
 * Postgres rejects a whole `on conflict do update` statement carrying one
 * conflict key twice, so a duplicate is not a wasted row: it loses every
 * verdict and every lead in the same statement. Proven against a real
 * database, because the rule that rejects it lives there.
 */

function judgement(score: number): Judgement {
  return {
    id: "ignored",
    relationship: "buyer",
    needState: "open",
    fit: 4,
    intent: 3,
    quality: 0.9,
    stage: "solution_seeking",
    decision: "qualify",
    reasonCode: "supported_open_need",
    needEvidence: { quote: "conditional logic" },
    reason: "Wants a form that branches.",
    engagement: 2,
    score,
    matchedPhrase: "conditional logic",
    subreddit: "forms",
  };
}

describe.skipIf(!process.env.DATABASE_URL)("writing one scan's verdicts and leads", () => {
  async function fixture() {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { upsertComments, upsertPosts } = await import("@/lib/reddit/store");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft" })
      .returning();
    const [post] = await upsertPosts([
      {
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: "Need a form tool",
        body: "Our signup form needs conditional logic.",
        permalink: "/r/SaaS/comments/x0/form/",
        createdUtc: Math.floor(Date.now() / 1000),
      },
    ]);
    const [comment] = await upsertComments(post.id, [
      {
        id: `c${randomUUID().slice(0, 8)}`,
        author: "buyer",
        body: "I need conditional logic too.",
        createdUtc: Math.floor(Date.now() / 1000),
      },
    ]);
    return { db, schema, user, project, post, comment };
  }

  it("keeps the last verdict when one candidate was judged twice", async () => {
    const { db, schema, user, project, post, comment } = await fixture();
    const { writeEvaluations } = await import("@/lib/scan/evaluations");
    const { eq } = await import("drizzle-orm");
    const base = { projectId: project.id, profileVersion: 1, contentHash: "hash" };

    const written = await writeEvaluations([
      { ...base, postId: post.id, commentId: null, judgement: judgement(60) },
      { ...base, postId: post.id, commentId: null, judgement: judgement(70) },
      { ...base, postId: post.id, commentId: comment.id, judgement: judgement(80) },
      { ...base, postId: post.id, commentId: comment.id, judgement: judgement(90) },
    ]);

    expect(written).toBe(2);
    const rows = await db()
      .select()
      .from(schema.leadEvaluations)
      .where(eq(schema.leadEvaluations.projectId, project.id));
    expect(rows.map((row) => row.score).sort()).toEqual([70, 90]);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("keeps the last lead when one candidate qualified twice", async () => {
    const { db, schema, user, project, post, comment } = await fixture();
    const { writeLeads } = await import("@/lib/scan/leads");
    const { eq } = await import("drizzle-orm");
    const base = {
      projectId: project.id,
      postId: post.id,
      quality: 0.7,
      fit: 4,
      intent: 3,
      engagement: 2,
      stage: "solution_seeking",
      kind: "buyer" as const,
      reason: "Wants a form that branches.",
      matchedPhrase: "conditional logic",
    };

    const written = await writeLeads([
      { ...base, commentId: null, score: 60 },
      { ...base, commentId: null, score: 70 },
      { ...base, commentId: comment.id, score: 80 },
      { ...base, commentId: comment.id, score: 90 },
    ]);

    expect(written).toBe(2);
    const rows = await db().select().from(schema.leads).where(eq(schema.leads.projectId, project.id));
    expect(rows.map((row) => row.score).sort()).toEqual([70, 90]);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("keeps which lane a lead is in, and moves it when the next verdict does", async () => {
    const { db, schema, user, project, post } = await fixture();
    const { writeLeads } = await import("@/lib/scan/leads");
    const { eq } = await import("drizzle-orm");
    const base = {
      projectId: project.id,
      postId: post.id,
      commentId: null,
      score: 60,
      quality: 0.55,
      fit: 3,
      intent: 1,
      engagement: 2,
      stage: "problem_aware",
      reason: "Nobody is asking, but the thread is about this.",
      matchedPhrase: "conditional logic",
    };

    await writeLeads([{ ...base, kind: "context" as const }]);
    const asContext = await db()
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.projectId, project.id));
    expect(asContext.map((row) => row.kind)).toEqual(["context"]);

    await writeLeads([{ ...base, kind: "buyer" as const }]);
    const asBuyer = await db()
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.projectId, project.id));
    expect(asBuyer.map((row) => row.kind)).toEqual(["buyer"]);
    // A rescore is a new judgement of the same find, so an alert never repeats it.
    expect(asBuyer[0].foundAt).toEqual(asContext[0].foundAt);
    expect(asBuyer[0].scoredAt.getTime()).toBeGreaterThanOrEqual(asContext[0].scoredAt.getTime());

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});

/**
 * The scan's bookkeeping after its leads: the plan rows whose windows it
 * covered, and the reply counts its lead threads were read at. Each is one
 * statement for the whole run, so a row or a post that reached it twice must
 * still come out as writing them one at a time would have left it.
 */
describe.skipIf(!process.env.DATABASE_URL)("marking what one scan covered and read", () => {
  it("moves every covered row's watermark, in both tables, and no other row's", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { markCovered } = await import("@/lib/scan/sources");
    const { eq } = await import("drizzle-orm");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft" })
      .returning();
    const keywords = await db()
      .insert(schema.projectKeywords)
      .values(
        ["form builder", "typeform alternative", "untouched"].map((keyword) => ({
          projectId: project.id,
          keyword,
        })),
      )
      .returning();
    const [community] = await db()
      .insert(schema.projectSubreddits)
      .values({ projectId: project.id, name: "SaaS" })
      .returning();
    const row = (id: string, table: "keyword" | "community") =>
      ({ id, table, key: id, source: "serp", state: "active", lastCoveredAt: null, evidence: 0 }) as never;
    const at = new Date("2026-09-30T12:00:00Z");
    const earlier = new Date("2026-09-29T12:00:00Z");

    await markCovered([
      { row: row(keywords[0].id, "keyword"), at },
      { row: row(keywords[1].id, "keyword"), at },
      // Listed again at another moment and then at this one: the last wins.
      { row: row(keywords[1].id, "keyword"), at: earlier },
      { row: row(keywords[0].id, "keyword"), at },
      { row: row(keywords[1].id, "keyword"), at },
      { row: row(community.id, "community"), at },
    ]);
    await markCovered([]);

    const held = await db()
      .select()
      .from(schema.projectKeywords)
      .where(eq(schema.projectKeywords.projectId, project.id));
    const covered = held.map((keyword) => [keyword.keyword, keyword.lastCoveredAt?.toISOString() ?? null]);
    expect(Object.fromEntries(covered)).toEqual({
      "form builder": at.toISOString(),
      "typeform alternative": at.toISOString(),
      untouched: null,
    });
    const [sub] = await db()
      .select()
      .from(schema.projectSubreddits)
      .where(eq(schema.projectSubreddits.id, community.id));
    expect(sub.lastCoveredAt?.toISOString()).toBe(at.toISOString());

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("records each lead thread's reply count, the last one for a post listed twice", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { upsertPosts } = await import("@/lib/reddit/store");
    const { markThreadsRead } = await import("@/lib/scan/leads");
    const { and, eq, isNull } = await import("drizzle-orm");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project, other] = await db()
      .insert(schema.projects)
      .values([
        { userId: user.id, name: "Formcraft" },
        { userId: user.id, name: "Someone else's view" },
      ])
      .returning();
    const posts = await upsertPosts(
      ["a", "b"].map((name) => ({
        id: `p${name}${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker",
        title: `Need a form tool ${name}`,
        permalink: `/r/SaaS/comments/x${name}/form/`,
        createdUtc: Math.floor(Date.now() / 1000),
        numComments: 4,
      })),
    );
    const comment = `c${randomUUID().slice(0, 8)}`;
    await db()
      .insert(schema.redditComments)
      .values({ id: comment, postId: posts[0].id, body: "Me too", createdAt: new Date() });
    await db()
      .insert(schema.leads)
      .values([
        ...posts.map((post) => ({
          projectId: project.id,
          postId: post.id,
          score: 70,
          kind: "buyer" as const,
        })),
        { projectId: project.id, postId: posts[0].id, commentId: comment, score: 70, kind: "buyer" as const },
        { projectId: other.id, postId: posts[0].id, score: 70, kind: "buyer" as const },
      ]);

    await markThreadsRead(project.id, [
      { ...posts[0], numComments: 4 },
      posts[1],
      { ...posts[0], numComments: 9 },
    ]);
    await markThreadsRead(project.id, []);

    const counts = await db()
      .select({
        postId: schema.leads.postId,
        commentId: schema.leads.commentId,
        count: schema.leads.threadReadCount,
      })
      .from(schema.leads)
      .where(eq(schema.leads.projectId, project.id));
    const countOf = (postId: string, commentId: string | null) =>
      counts.find((row) => row.postId === postId && row.commentId === commentId)?.count;
    expect(countOf(posts[0].id, null)).toBe(9);
    expect(countOf(posts[1].id, null)).toBe(4);
    // A comment's lead is not the thread's, and another project's lead is its own.
    expect(countOf(posts[0].id, comment)).toBeNull();
    const [theirs] = await db()
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.projectId, other.id), isNull(schema.leads.commentId)));
    expect(theirs.threadReadCount).toBeNull();

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});
