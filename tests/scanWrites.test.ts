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
    sellerSide: false,
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
