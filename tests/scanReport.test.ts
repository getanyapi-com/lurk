import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verdictSentence, type ScanReport } from "@/lib/scan/report";
import { describeDb, makePost, makeProject, makeUser } from "./fixtures/db";

/**
 * What a window of scanning reports, and what the page says when that report is
 * all the user has. The counts are SQL, so they are answered against a real
 * database; the sentence is a pure function of the counts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describeDb("counting one window of scanning", () => {
  async function fixture() {
    const { db } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    const user = await makeUser();
    const project = await makeProject(user.id);

    /**
     * A post of a given age, kept out of the retention sweep's reach.
     * deleteExpiredPosts drops every post past the retention window across the
     * whole database, and a lead pointing at a post spares it, so the post is
     * written at today's date, given its lead, and only then aged. It is never
     * both old and unreferenced, whatever runs beside this file.
     */
    async function post(ageDays: number) {
      const row = await makePost({
        url: `https://www.reddit.com/r/SaaS/comments/${randomUUID().slice(0, 6)}/form/`,
      });
      await db().insert(schema.leads).values({ projectId: project.id, postId: row.id, score: 0 });
      const [aged] = await db()
        .update(schema.redditPosts)
        .set({ createdAt: new Date(Date.now() - ageDays * DAY_MS) })
        .where(eq(schema.redditPosts.id, row.id))
        .returning();
      return aged;
    }

    async function comment(postId: string, ageDays: number) {
      const [row] = await db()
        .insert(schema.redditComments)
        .values({
          id: `c${randomUUID().slice(0, 8)}`,
          postId,
          author: "asker",
          body: "Still looking for one.",
          createdAt: new Date(Date.now() - ageDays * DAY_MS),
        })
        .returning();
      return row;
    }

    /** A verdict written just now, whatever age the thing it judged is. */
    async function judged(decision: string, postAgeDays: number, commentId?: string) {
      const row = await post(postAgeDays);
      await db()
        .insert(schema.leadEvaluations)
        .values({
          projectId: project.id,
          postId: row.id,
          commentId: commentId ?? null,
          decision,
          relationship: "self",
          needState: "open",
          engagement: 1,
          score: 60,
          reasonCodes: [],
          reason: "test",
          profileVersion: 1,
          contentHash: randomUUID(),
          scorerVersion: "test",
          judgedAt: new Date(),
        });
      return row;
    }

    return { project, post, comment, judged };
  }

  it("counts the verdicts inside the window and leaves the older one out", async () => {
    const { project, judged } = await fixture();
    await judged("qualify", 1);
    await judged("review", 2);
    await judged("reject", 3);
    await judged("reject", 40);
    const { scanReport } = await import("@/lib/scan/report");

    expect(await scanReport(project.id, 7)).toMatchObject({
      read: 3,
      qualified: 1,
      held: 1,
      rejected: 1,
    });
    expect(await scanReport(project.id, "all")).toMatchObject({ read: 4, rejected: 2 });
  });

  it("leaves out a verdict written today on a post nobody wrote this window", async () => {
    const { project, judged } = await fixture();
    await judged("qualify", 40);
    const { scanReport } = await import("@/lib/scan/report");

    expect(await scanReport(project.id, 7)).toMatchObject({ read: 0, qualified: 0 });
    expect(await scanReport(project.id, "all")).toMatchObject({ read: 1, qualified: 1 });
  });

  it("dates a comment verdict by the comment, not by the thread it sits in", async () => {
    const { project, post, comment, judged } = await fixture();
    const thread = await post(40);
    const reply = await comment(thread.id, 1);
    await judged("qualify", 40, reply.id);
    const { scanReport } = await import("@/lib/scan/report");

    expect(await scanReport(project.id, 7)).toMatchObject({ read: 1, qualified: 1 });
  });
});

describe("what the page says about a window", () => {
  function report(patch: Partial<ScanReport>): ScanReport {
    return { read: 0, qualified: 0, held: 0, rejected: 0, ...patch };
  }

  it("says nothing has been read when no candidate has a verdict", () => {
    expect(verdictSentence(report({}), 0)).toBe(
      "No scan has read this window yet.",
    );
  });

  it("says Reddit talks about this and nobody asked to buy, with the counts", () => {
    const sentence = verdictSentence(
      report({ read: 30, qualified: 0, held: 2, rejected: 28 }),
      0,
    );
    expect(sentence).toBe(
      "Reddit talks about this, but nobody in this window asked to buy. We read 30 posts, 0 cleared the bar and 2 held for review.",
    );
  });

  it("gives the counts alone once there are leads to show", () => {
    const sentence = verdictSentence(
      report({ read: 30, qualified: 4, held: 2, rejected: 24 }),
      4,
    );
    expect(sentence).toBe("We read 30 posts, 4 cleared the bar and 2 held for review.");
  });

  it("counts a single read post as one post", () => {
    expect(verdictSentence(report({ read: 1, qualified: 1 }), 1)).toBe(
      "We read 1 post, 1 cleared the bar and 0 held for review.",
    );
  });
});
