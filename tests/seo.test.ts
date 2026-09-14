import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { competitorNamed } from "@/lib/seo/competitors";
import { seoSettings } from "@/lib/seo/limits";
import { redditResults, redditThread } from "@/lib/seo/links";
import { TIERS } from "@/lib/tiers";

/** Only the booking is faked; writeProgress still writes to the real jobs row. */
vi.mock("@/jobs/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/jobs/enqueue")>()),
  enqueueJob: vi.fn(),
}));

describe("Reddit thread links", () => {
  it("reads the community and the post out of a thread URL on any reddit host", () => {
    expect(redditThread("https://www.reddit.com/r/SaaS/comments/abc123/some_title/")).toEqual({
      subreddit: "SaaS",
      postId: "abc123",
      canonicalUrl: "https://www.reddit.com/r/SaaS/comments/abc123/",
    });
    expect(redditThread("https://old.reddit.com/r/SaaS/comments/abc123/")?.postId).toBe("abc123");
    expect(redditThread("https://reddit.com/r/SaaS/comments/abc123/")?.subreddit).toBe("SaaS");
  });

  it("rejects mirrors, non-thread pages and anything unparseable", () => {
    expect(redditThread("https://notreddit.com/r/SaaS/comments/abc123/")).toBeNull();
    expect(redditThread("https://reddit.com.example.net/r/SaaS/comments/abc123/")).toBeNull();
    expect(redditThread("https://www.reddit.com/r/SaaS/")).toBeNull();
    expect(redditThread("https://www.reddit.com/user/someone/")).toBeNull();
    expect(redditThread("https://www.reddit.com/r/SaaS/comments/")).toBeNull();
    expect(redditThread("/r/SaaS/comments/abc123/")).toBeNull();
  });

  it("keeps Google's own order and positions", () => {
    const kept = redditResults([
      { link: "https://example.com/a", position: 1 },
      { link: "https://www.reddit.com/r/SaaS/comments/a/", position: 2 },
      { link: "https://old.reddit.com/r/nocode/comments/b/", position: 3 },
      { link: "https://www.reddit.com/r/SaaS/", position: 4 },
    ]);
    expect(kept.map((result) => result.position)).toEqual([2, 3]);
  });
});

describe("competitor match", () => {
  it("finds a name in the title or the body whatever its case", () => {
    expect(competitorNamed(["Typeform"], "Is TYPEFORM worth it?", null)).toBe(true);
    expect(competitorNamed(["Typeform"], "Best form tool", "we moved off typeform")).toBe(true);
  });

  it("says no when no competitor is named", () => {
    expect(competitorNamed(["Typeform", "Tally"], "Best form tool", "google forms is fine")).toBe(
      false,
    );
  });

  it("ignores an empty competitor rather than matching everything", () => {
    expect(competitorNamed(["  "], "Best form tool", "anything")).toBe(false);
    expect(competitorNamed([], "Best form tool", "anything")).toBe(false);
  });
});

describe("phrasing cap", () => {
  const phrasings = Array.from({ length: 12 }, (_, index) => `way of asking ${index}`);

  it("cuts a free project to the tier's allowance and refreshes weekly", () => {
    const settings = seoSettings(TIERS.free, phrasings);
    expect(settings.phrasings).toHaveLength(10);
    expect(settings.phrasings[0]).toBe("way of asking 0");
    expect(settings.refreshDays).toBe(7);
  });

  it("caps nothing for a connected wallet", () => {
    const settings = seoSettings(TIERS.connected, phrasings);
    expect(settings.phrasings).toHaveLength(12);
  });

  it("treats a self-hosted instance like a connected wallet", () => {
    expect(seoSettings(null, phrasings).phrasings).toHaveLength(12);
    expect(seoSettings(null, phrasings).refreshDays).toBe(1);
  });
});

/**
 * The refresh searches the way buyers say the problem. It used to search the
 * plan's Reddit queries, which are Boolean expressions Google reads as
 * literal text, so this is the seam that has to stay pointed at the phrasings.
 */
describe.skipIf(!process.env.DATABASE_URL)("what a refresh searches", () => {
  it("takes the project's phrasings, never its Reddit Boolean queries", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { loadScanProject } = await import("@/lib/scan/project");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({
        userId: user.id,
        name: "HotelsAllow",
        problemPhrasings: ["hotels that let 19 year olds check in"],
      })
      .returning();
    await db()
      .insert(schema.projectKeywords)
      .values({ projectId: project.id, keyword: "(hotel OR hotels) AND (18 OR 19)" });

    const loaded = await loadScanProject(project.id);
    const settings = seoSettings(TIERS.free, loaded?.phrasings ?? []);
    expect(settings.phrasings).toEqual(["hotels that let 19 year olds check in"]);
    expect(settings.phrasings).not.toContain("(hotel OR hotels) AND (18 OR 19)");
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});

/**
 * The refresh used to return before booking anything when a project had no
 * phrasings yet, so the one job a new project gets was also its last: the page
 * kept saying the first refresh had finished and nothing ever looked again.
 */
describe.skipIf(!process.env.DATABASE_URL)("what a refresh books next", () => {
  it("books the next refresh even when there are no phrasings to search", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { enqueueJob } = await import("@/jobs/enqueue");
    const { runSeoRefresh } = await import("@/lib/seo/refresh");
    const booked = vi.mocked(enqueueJob);
    booked.mockClear();

    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "No phrasings yet", problemPhrasings: [] })
      .returning();
    const [job] = await db()
      .insert(schema.jobs)
      .values({ kind: "seo_refresh", projectId: project.id, runAt: new Date() })
      .returning();

    const outcome = await runSeoRefresh(project.id, job.id);

    expect(outcome).toEqual({ phrasings: 0, threads: 0, costUsd: 0 });
    expect(booked).toHaveBeenCalledTimes(1);
    const [kind, projectId, runAt] = booked.mock.calls[0];
    expect(kind).toBe("seo_refresh");
    expect(projectId).toBe(project.id);
    expect(runAt!.getTime()).toBeGreaterThan(Date.now());

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});

/**
 * Discovery already judges every thread it buys, and since both sides ask
 * Google the one question, the threads that rank for a phrasing are the ones
 * it judged. The tab used to list them in Google's order alone, so a thread
 * with nobody asking in it sat above one with a buyer in it. It sorts on the
 * verdict now and hides nothing: a thread nobody asked in still ranks, and one
 * reply in it still works.
 */
describe.skipIf(!process.env.DATABASE_URL)("the order ranking threads are read in", () => {
  it("puts the threads worth replying in first, and an unjudged one above a rejected one", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { listOpportunities, verdictOf } = await import("@/lib/seo/read");

    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "AnyAPI" })
      .returning();

    const run = randomUUID().replace(/-/g, "").slice(0, 8);
    const verdicts = [
      ["irrelevant", 1],
      ["unlabeled", 2],
      ["plausible", 3],
      ["relevant", 4],
    ] as const;
    for (const [relevance, position] of verdicts) {
      const postId = `${run}${relevance}`;
      await db().insert(schema.redditPosts).values({
        id: postId,
        subreddit: "webscraping",
        title: `A thread judged ${relevance}`,
        url: `https://www.reddit.com/r/webscraping/comments/${postId}/x/`,
        createdAt: new Date(),
      });
      await db().insert(schema.seoOpportunities).values({
        projectId: project.id,
        keyword: "reddit scraper",
        postId,
        position,
        competitorPresent: false,
        refreshedAt: new Date(),
      });
      await db().insert(schema.discoveryEvidence).values({
        projectId: project.id,
        postId,
        canonicalUrl: `https://www.reddit.com/r/webscraping/comments/${postId}/x/`,
        subreddit: "webscraping",
        query: "reddit scraper reddit",
        position,
        title: `A thread judged ${relevance}`,
        relevance,
      });
    }

    const rows = await listOpportunities(project.id, {});
    expect(rows.map((row) => row.postId)).toEqual([
      `${run}relevant`,
      `${run}plausible`,
      `${run}unlabeled`,
      `${run}irrelevant`,
    ]);
    expect(rows.map((row) => verdictOf(row.verdictRank))).toEqual([
      "relevant",
      "plausible",
      null,
      "irrelevant",
    ]);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
    await db()
      .delete(schema.redditPosts)
      .where(
        inArray(
          schema.redditPosts.id,
          verdicts.map(([relevance]) => `${run}${relevance}`),
        ),
      );
  });
});

/**
 * The refresh pays to judge a ranking thread only when nothing has judged it.
 * Discovery and this refresh ask Google the one question, so most threads
 * arrive with a verdict already on them, and asking the model about those
 * again would buy an answer this project already holds.
 */
describe.skipIf(!process.env.DATABASE_URL)("what a refresh pays to judge", () => {
  it("judges only the ranking threads nothing has judged yet", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const label = await import("@/lib/discovery/label");
    const { judgeUnseen } = await import("@/lib/seo/refresh");

    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "AnyAPI" })
      .returning();

    const run = randomUUID().replace(/-/g, "").slice(0, 8);
    const judged = `${run}judged`;
    const fresh = `${run}fresh`;
    await db().insert(schema.discoveryEvidence).values({
      projectId: project.id,
      postId: judged,
      canonicalUrl: `https://www.reddit.com/r/webscraping/comments/${judged}/x/`,
      subreddit: "webscraping",
      query: "reddit scraper reddit",
      position: 1,
      title: "Discovery already read this one",
      relevance: "relevant",
    });

    const asked = vi.spyOn(label, "labelThreads").mockResolvedValue([
      { id: fresh, relevance: "irrelevant", destination: null, entities: [] },
    ]);
    await judgeUnseen(
      { id: project.id, productText: "One key for many data APIs" } as never,
      [judged, fresh].map((postId, index) => ({
        postId,
        canonicalUrl: `https://www.reddit.com/r/webscraping/comments/${postId}/x/`,
        subreddit: "webscraping",
        query: "reddit scraper reddit",
        position: index + 1,
        title: `A ranking thread ${postId}`,
        snippet: "Someone wrote something here.",
      })),
    );

    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0][0].candidates.map((item) => item.id)).toEqual([fresh]);
    const rows = await db()
      .select()
      .from(schema.discoveryEvidence)
      .where(eq(schema.discoveryEvidence.projectId, project.id));
    const byPost = new Map(rows.map((row) => [row.postId, row.relevance]));
    expect(byPost.get(judged)).toBe("relevant");
    expect(byPost.get(fresh)).toBe("irrelevant");

    asked.mockRestore();
    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});
