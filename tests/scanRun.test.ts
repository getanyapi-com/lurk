import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredPost } from "@/lib/reddit/store";
import { judgeAnswers, readingAnswers, triageAnswers, type JevSpec } from "./jevAnswers";

/**
 * The scan's order of operations, against a real database with only AnyAPI and
 * the language model faked. These are the things a unit test of a pure function
 * cannot prove: that a verdict is stored once and reused, that leads are
 * committed before a comment fetch can fail, and that an author saying the
 * need is met takes their lead out of the feed.
 */

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));
const fetchSearch = vi.fn();
const fetchSubredditPosts = vi.fn();
const fetchPost = vi.fn();
const fetchPostComments = vi.fn();
const fetchAuthorProfile = vi.fn();
const fetchSubredditDetails = vi.fn();
const fetchFeedThreads = vi.fn();

vi.mock("@/lib/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jev")>()),
  askJev,
}));
vi.mock("@/lib/reddit/skus", () => ({
  fetchSearch,
  fetchSubredditPosts,
  fetchPost,
  fetchPostComments,
  fetchAuthorProfile,
  fetchSubredditDetails,
}));
vi.mock("@/lib/scan/serp", () => ({ fetchFeedThreads, FEED_TIMEFRAME: "7d" }));
vi.mock("@/lib/anyapi", () => ({
  clientForUser: async () => ({
    client: {},
    funding: "house" as const,
    call: async <T>(fn: () => Promise<T>) => ({ result: await fn(), requestId: null }),
  }),
  walletConnection: async () => null,
}));

const hasDatabase = !!process.env.DATABASE_URL;

/** One candidate as a Jev request carries it: a title, or a post's sentences. */
type Asked = { title?: string; sentences?: Record<string, string> };

/** Everything the model was shown about one candidate, as one string. */
function wordsOf(one: Asked): string {
  return one.title ?? Object.values(one.sentences ?? {}).join(" ");
}

describe.skipIf(!hasDatabase)("runScan against a database", () => {
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let runScan: typeof import("@/lib/scan/run").runScan;
  let upsertPosts: typeof import("@/lib/reddit/store").upsertPosts;
  let upsertComments: typeof import("@/lib/reddit/store").upsertComments;
  let listLeads: typeof import("@/lib/leads").listLeads;
  let listReviewItems: typeof import("@/lib/leads").listReviewItems;
  let eq: typeof import("drizzle-orm").eq;

  beforeEach(async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ runScan } = await import("@/lib/scan/run"));
    ({ upsertPosts, upsertComments } = await import("@/lib/reddit/store"));
    ({ listLeads, listReviewItems } = await import("@/lib/leads"));
    ({ eq } = await import("drizzle-orm"));
    askJev.mockReset();
    for (const mock of [fetchSearch, fetchSubredditPosts, fetchPost, fetchPostComments]) {
      mock.mockReset();
    }
    fetchFeedThreads.mockReset();
    fetchFeedThreads.mockResolvedValue({ value: [], reused: true, costUsd: 0 });
    fetchSubredditPosts.mockResolvedValue({ value: { posts: [], nextCursor: null }, reused: true, costUsd: 0 });
    fetchAuthorProfile.mockResolvedValue({ value: null, reused: true, costUsd: 0 });
    fetchPostComments.mockResolvedValue({ value: [], reused: true, costUsd: 0 });
  });

  async function project(threshold: number | null = null) {
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [row] = await db()
      .insert(schema.projects)
      .values({
        userId: user.id,
        name: "Formcraft",
        solution: "A form builder with conditional logic.",
        scoreThreshold: threshold,
      })
      .returning();
    await db()
      .insert(schema.projectKeywords)
      .values({ projectId: row.id, keyword: "form builder" });
    return row;
  }

  const BODY = "Our signup form needs conditional logic.";

  /**
   * What opening a listing-shaped post does: `reddit.post` carries the text,
   * and the shared row keeps it, which is what lets the next scan reuse the
   * verdict instead of judging the same words again.
   */
  async function opened(post: StoredPost): Promise<StoredPost> {
    const [row] = await upsertPosts([
      {
        id: post.id,
        subreddit: post.subreddit,
        author: post.author ?? undefined,
        title: post.title,
        body: BODY,
        url: post.url,
        score: post.score ?? undefined,
        numComments: post.numComments ?? undefined,
        createdUtc: Math.floor(post.createdAt.getTime() / 1000),
      },
    ]);
    return row;
  }

  /**
   * Candidates as they arrive with their text, which is what a search result
   * now does. Pass `body: undefined` for a listing-shaped post the scan still
   * has to open.
   */
  async function posts(
    count: number,
    patch: { body?: string | undefined; author?: string } = {},
  ) {
    const now = Math.floor(Date.now() / 1000);
    return upsertPosts(
      Array.from({ length: count }, (_, index) => ({
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: `asker${index}`,
        title: `Form question ${index}`,
        body: BODY,
        permalink: `/r/SaaS/comments/x${index}/form/`,
        score: 3,
        numComments: 2,
        createdUtc: now - 3600,
        ...patch,
      })),
    );
  }

  /**
   * Jev's answers for every call of the sweep, from the words each candidate
   * was shown with. `asking` orders the triage, and `judgement` says what the
   * reading and the judgement found; by default every title is worth reading
   * and every author is a buyer with an open need the product covers.
   */
  function model(
    asking: (title: string) => number = () => 0.9,
    judgement: (words: string) => JevSpec = () => ({}),
  ) {
    askJev.mockImplementation(
      async (call: {
        purpose: string;
        state: { titles?: Record<string, Asked>; posts?: Record<string, Asked> };
      }) => {
        if (call.purpose === "triage") {
          return triageAnswers(
            Object.values(call.state.titles ?? {}).map((one) => ({
              asking: asking(one.title ?? ""),
            })),
          );
        }
        const specs = Object.values(call.state.posts ?? {}).map((one) => ({
          quote: "s0",
          ...judgement(wordsOf(one)),
        }));
        return call.purpose === "reading" ? readingAnswers(specs) : judgeAnswers(specs);
      },
    );
  }

  /** A judgement the gates reject as a job the product does not do. */
  const wrongJob: JevSpec = { solvesProblem: 0.1, audience: 0.1 };

  /** A judgement the gates hold for review: a requirement the facts cannot settle. */
  const oneUnknown: JevSpec = { hardRequirement: "unknown" };

  async function evaluations(projectId: string) {
    return db()
      .select()
      .from(schema.leadEvaluations)
      .where(eq(schema.leadEvaluations.projectId, projectId));
  }

  it("reads in triage order, stores every verdict, and reuses them on the next scan", async () => {
    const row = await project();
    const [first, second, third] = await posts(3, { body: undefined });
    fetchSearch.mockResolvedValue({ value: { posts: [first, second, third], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockImplementation(async (_ctx: unknown, url: string) => ({
      value: [await opened([first, second, third].find((post) => post.url === url)!)],
      reused: true,
      costUsd: 0,
    }));
    model(
      (title) => ({ [second.title]: 0.9, [third.title]: 0.6 })[title] ?? 0.3,
      (words) => (words.includes(second.title) ? {} : wrongJob),
    );

    const outcome = await runScan(row.id, randomUUID());
    expect(fetchPost.mock.calls.map((call) => call[1])).toEqual([
      second.url,
      third.url,
      first.url,
    ]);
    expect(outcome.leads).toBe(1);
    const stored = await evaluations(row.id);
    expect(stored).toHaveLength(3);
    expect(stored.filter((one) => one.decision === "reject")).toHaveLength(2);

    askJev.mockClear();
    // The second scan finds the same posts, and by now we hold their text.
    fetchSearch.mockResolvedValue({
      value: {
        posts: [await opened(first), await opened(second), await opened(third)],
        nextCursor: null,
      },
      reused: true,
      costUsd: 0,
    });
    await runScan(row.id, randomUUID());
    expect(askJev).not.toHaveBeenCalled();
    expect(fetchPost).toHaveBeenCalledTimes(3);
  });

  it("never opens a post that arrived with its own text", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    model();

    const outcome = await runScan(row.id, randomUUID());
    expect(fetchPost).not.toHaveBeenCalled();
    expect(outcome.leads).toBe(1);
  });

  it("spends the hydration budget only on the posts it still has to open", async () => {
    const { limitsFor } = await import("@/lib/tiers");
    const cap = limitsFor("free", false)!.hydrationPerScan;
    const selfHosted = process.env.SELF_HOSTED;
    process.env.SELF_HOSTED = "false";
    try {
      const row = await project();
      const carried = await posts(cap + 1);
      fetchSearch.mockResolvedValue({
        value: { posts: carried, nextCursor: null },
        reused: true,
        costUsd: 0,
      });
      model();

      await runScan(row.id, randomUUID());
      expect(fetchPost).not.toHaveBeenCalled();
      expect(await evaluations(row.id)).toHaveLength(cap + 1);
    } finally {
      process.env.SELF_HOSTED = selfHosted;
    }
  });

  it("keeps a post the shared reading calls a seller away from the judge", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model(undefined, () => ({ relationship: "seller", needState: "no_active_need" }));

    const outcome = await runScan(row.id, randomUUID());
    const judged = askJev.mock.calls.filter((call) => call[0].purpose === "score");
    expect(judged).toHaveLength(0);
    expect(outcome.leads).toBe(0);
    const stored = await evaluations(row.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.decision).toBe("reject");
    expect(stored[0]?.reasonCodes).toContain("seller_only");
  });

  it("reads one post once however many projects are watching it", async () => {
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model();

    const readings = () =>
      askJev.mock.calls.filter((call) => call[0].purpose === "reading");

    await runScan((await project()).id, randomUUID());
    expect(readings()).toHaveLength(1);

    askJev.mockClear();
    await runScan((await project()).id, randomUUID());
    expect(readings()).toHaveLength(0);
  });

  it("never triages, judges or stores a post Reddit has taken away", async () => {
    const row = await project();
    const [live] = await posts(1);
    const [gone] = await posts(1, { body: "[removed]" });
    const [ghost] = await posts(1, { author: "[deleted]" });
    fetchSearch.mockResolvedValue({ value: { posts: [live, gone, ghost], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [live], reused: true, costUsd: 0 });
    model();

    const outcome = await runScan(row.id, randomUUID());
    const asked = askJev.mock.calls.map((call) => call[0]);
    expect(asked).not.toHaveLength(0);
    expect(asked.every((call) => call.itemsAsked === 1)).toBe(true);
    expect(outcome.candidates).toBe(1);
    expect((await evaluations(row.id)).map((one) => one.postId)).toEqual([live.id]);
  });

  it("dates a held candidate with a real Date, not the raw column text", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model(undefined, () => oneUnknown);

    await runScan(row.id, randomUUID());
    const held = await listReviewItems(row.id, 30);
    expect(held).toHaveLength(1);
    expect(held[0]?.createdAt).toBeInstanceOf(Date);
    expect(held[0]?.judgedAt).toBeInstanceOf(Date);
  });

  /**
   * The feed says what the current verdict says. Until 2026-09-13 a lead the
   * scorer had stopped believing in stayed in the feed and was kept out of the
   * held pile, so a person could be sold a buyer that no scorer would qualify
   * today. A lead the person has already acted on is still theirs.
   */
  it("takes back a lead the next verdict no longer qualifies", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model(undefined, () => ({ hardRequirement: "none_stated" }));
    await runScan(row.id, randomUUID());
    expect(await listLeads(row.id, { status: "new", days: 30 })).toHaveLength(1);

    await db()
      .update(schema.projects)
      .set({ profileVersion: 2, solution: "A form builder that also analyses answers." })
      .where(eq(schema.projects.id, row.id));
    model(undefined, () => oneUnknown);
    await runScan(row.id, randomUUID());

    expect(await listLeads(row.id, { status: "new", days: 30 })).toHaveLength(0);
    expect(await listReviewItems(row.id, 30)).toHaveLength(1);
  });

  it("leaves a lead the person already acted on where they put it", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model(undefined, () => ({ hardRequirement: "none_stated" }));
    await runScan(row.id, randomUUID());
    await db()
      .update(schema.leads)
      .set({ status: "not_fit", notFitReason: "wrong_market" })
      .where(eq(schema.leads.projectId, row.id));

    await db()
      .update(schema.projects)
      .set({ profileVersion: 2, solution: "A form builder that also analyses answers." })
      .where(eq(schema.projects.id, row.id));
    model(undefined, () => oneUnknown);
    await runScan(row.id, randomUUID());

    const kept = await db()
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.projectId, row.id));
    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe("not_fit");
    expect(kept[0].notFitReason).toBe("wrong_market");
  });

  it("judges a candidate again once the product profile has changed", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model(undefined, () => wrongJob);
    await runScan(row.id, randomUUID());

    await db()
      .update(schema.projects)
      .set({ profileVersion: 2, solution: "A form builder that also analyses answers." })
      .where(eq(schema.projects.id, row.id));
    askJev.mockClear();
    await runScan(row.id, randomUUID());
    expect(askJev).toHaveBeenCalled();
    expect(await evaluations(row.id)).toHaveLength(1);
  });

  it("keeps the leads it qualified when the comment fetch fails", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    fetchPostComments.mockRejectedValue(new Error("upstream is down"));
    model();

    await runScan(row.id, randomUUID());
    const rows = await db().select().from(schema.leads).where(eq(schema.leads.projectId, row.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].postId).toBe(only.id);
  });

  it("counts and writes one lead per qualified post and per qualified commenter", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    const commentId = `c${randomUUID().slice(0, 8)}`;
    fetchPostComments.mockImplementation(async () => ({
      value: await upsertComments(only.id, [
        {
          id: commentId,
          author: "buyer",
          body: "I need conditional logic on my own signup form too.",
          score: 2,
          url: "/r/SaaS/comments/x0/form/c9/",
          createdUtc: Math.floor(Date.now() / 1000),
        },
      ]),
      reused: false,
      costUsd: 0,
    }));
    model();

    const outcome = await runScan(row.id, randomUUID());
    const rows = await db().select().from(schema.leads).where(eq(schema.leads.projectId, row.id));
    expect(rows).toHaveLength(2);
    expect(outcome.leads).toBe(2);
    expect(rows.filter((one) => one.commentId === commentId)).toHaveLength(1);
  });


  async function community(projectId: string, name: string) {
    const [row] = await db()
      .insert(schema.projectSubreddits)
      .values({ projectId, name })
      .returning();
    return row;
  }

  async function sourcesOf(projectId: string) {
    return db()
      .select()
      .from(schema.candidateSources)
      .where(eq(schema.candidateSources.projectId, projectId));
  }

  it("records every source that found a post, and credits each of them", async () => {
    const row = await project();
    const [only] = await posts(1);
    await community(row.id, only.subreddit);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchSubredditPosts.mockResolvedValue({
      value: { posts: [only], nextCursor: null },
      reused: true,
      costUsd: 0,
    });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    model();

    const outcome = await runScan(row.id, randomUUID());
    expect(outcome.candidates).toBe(1);
    const sources = await sourcesOf(row.id);
    expect(sources.map((one) => one.sourceKind).sort()).toEqual(["listing", "scoped", "search"]);
    expect(sources.every((one) => one.postId === only.id)).toBe(true);

    const [keyword] = await db()
      .select()
      .from(schema.projectKeywords)
      .where(eq(schema.projectKeywords.projectId, row.id));
    const [sub] = await db()
      .select()
      .from(schema.projectSubreddits)
      .where(eq(schema.projectSubreddits.projectId, row.id));
    expect(keyword.freshCandidates).toBe(1);
    expect(keyword.freshLeads).toBe(1);
    expect(sub.freshCandidates).toBe(1);
    expect(sub.freshLeads).toBe(1);
    expect(keyword.lastCoveredAt).toBeInstanceOf(Date);
    expect(sub.lastCoveredAt).toBeInstanceOf(Date);

    const { sourceYield } = await import("@/lib/usage");
    const perSource = await sourceYield(row.id);
    expect(perSource.map((one) => one.kind).sort()).toEqual(["listing", "scoped", "search"]);
    expect(perSource.every((one) => one.candidates === 1 && one.leads === 1)).toBe(true);
  });

  it("reads the younger post first when the triage ranks two candidates alike", async () => {
    const row = await project();
    const now = Math.floor(Date.now() / 1000);
    const [older, younger] = await upsertPosts([
      {
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker0",
        title: "Older form question",
        permalink: "/r/SaaS/comments/older/form/",
        score: 9,
        numComments: 2,
        createdUtc: now - 5 * 24 * 3600,
      },
      {
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker1",
        title: "Newer form question",
        permalink: "/r/SaaS/comments/newer/form/",
        score: 1,
        numComments: 2,
        createdUtc: now - 3600,
      },
    ]);
    fetchSearch.mockResolvedValue({
      value: { posts: [older, younger], nextCursor: null },
      reused: true,
      costUsd: 0,
    });
    fetchPost.mockImplementation(async (_ctx: unknown, url: string) => ({
      value: [await opened([older, younger].find((post) => post.url === url)!)],
      reused: true,
      costUsd: 0,
    }));
    model();

    await runScan(row.id, randomUUID());
    expect(fetchPost.mock.calls.map((call) => call[1])).toEqual([younger.url, older.url]);
  });

  it("walks a listing to its page budget and says so instead of moving the watermark", async () => {
    const row = await project();
    const [first, second] = await posts(2);
    await community(row.id, first.subreddit);
    fetchSearch.mockResolvedValue({ value: { posts: [], nextCursor: null }, reused: true, costUsd: 0 });
    let served = 0;
    fetchSubredditPosts.mockImplementation(async () => {
      served += 1;
      return {
        value: { posts: served === 1 ? [first] : [second], nextCursor: `page-${served + 1}` },
        reused: true,
        costUsd: 0,
      };
    });
    fetchPost.mockImplementation(async (_ctx: unknown, url: string) => ({
      value: [[first, second].find((post) => post.url === url)],
      reused: true,
      costUsd: 0,
    }));
    model(undefined, () => wrongJob);

    const { retrievalBudgets } = await import("@/lib/scan/constants");
    const { limitsFor } = await import("@/lib/tiers");
    const { config } = await import("@/lib/config");
    const pages = retrievalBudgets(limitsFor("free", config().SELF_HOSTED)).pages;

    const outcome = await runScan(row.id, randomUUID());
    const cursors = fetchSubredditPosts.mock.calls.map((call) => call[2]?.cursor);
    expect(cursors).toEqual([
      undefined,
      ...Array.from({ length: pages - 1 }, (_, index) => `page-${index + 2}`),
    ]);
    expect(outcome.gaps).toHaveLength(1);
    expect(outcome.gaps[0]).toContain(first.subreddit);
    const [sub] = await db()
      .select()
      .from(schema.projectSubreddits)
      .where(eq(schema.projectSubreddits.projectId, row.id));
    expect(sub.lastCoveredAt).toBeNull();
  });

  it("opens a Google result to date it, and drops one older than the feed window", async () => {
    const row = await project();
    const now = Math.floor(Date.now() / 1000);
    const [stale] = await upsertPosts([
      {
        id: `p${randomUUID().slice(0, 8)}`,
        subreddit: "SaaS",
        author: "asker0",
        title: "A form question from last winter",
        body: "Our signup form needs conditional logic.",
        permalink: "/r/SaaS/comments/stale/form/",
        score: 40,
        numComments: 12,
        createdUtc: now - 90 * 24 * 3600,
      },
    ]);
    fetchSearch.mockResolvedValue({ value: { posts: [], nextCursor: null }, reused: true, costUsd: 0 });
    fetchFeedThreads.mockResolvedValue({
      value: [
        {
          subreddit: "SaaS",
          postId: stale.id,
          canonicalUrl: `https://www.reddit.com/r/SaaS/comments/${stale.id}/`,
        },
      ],
      reused: false,
      costUsd: 0.0009,
    });
    fetchPost.mockResolvedValue({ value: [stale], reused: true, costUsd: 0 });
    model();

    const outcome = await runScan(row.id, randomUUID());
    expect(fetchPost).toHaveBeenCalledTimes(1);
    expect(outcome.candidates).toBe(0);
    expect(await sourcesOf(row.id)).toHaveLength(0);
  });

  it("reads the thread of a held candidate whose verdict asked for more evidence", async () => {
    const row = await project();
    const [held, other] = await posts(2);
    fetchSearch.mockResolvedValue({
      value: { posts: [held, other], nextCursor: null },
      reused: true,
      costUsd: 0,
    });
    fetchPost.mockImplementation(async (_ctx: unknown, url: string) => ({
      value: [[held, other].find((post) => post.url === url)],
      reused: true,
      costUsd: 0,
    }));
    model(undefined, (words) => (words.includes(held.title) ? oneUnknown : wrongJob));

    await runScan(row.id, randomUUID());
    expect(fetchPostComments.mock.calls.map((call) => call[1])).toEqual([held.id]);
  });

  it("takes a lead out of the feed once its author says the need is met", async () => {
    const row = await project();
    const [only] = await posts(1);
    fetchSearch.mockResolvedValue({ value: { posts: [only], nextCursor: null }, reused: true, costUsd: 0 });
    fetchPost.mockResolvedValue({ value: [only], reused: true, costUsd: 0 });
    fetchPostComments.mockImplementation(async () => ({
      value: await upsertComments(only.id, [
        {
          id: `c${randomUUID().slice(0, 8)}`,
          author: only.author ?? "asker0",
          body: "We bought Formcraft, this is solved.",
          score: 2,
          url: "/r/SaaS/comments/x0/form/c1/",
          createdUtc: Math.floor(Date.now() / 1000),
        },
      ]),
      reused: false,
      costUsd: 0,
    }));
    model(undefined, (words) =>
      words.includes("this is solved") ? { needState: "resolved" } : {},
    );

    await runScan(row.id, randomUUID());
    const rows = await db().select().from(schema.leads).where(eq(schema.leads.projectId, row.id));
    expect(rows[0].status).toBe("resolved");
    const feed = await listLeads(row.id, { status: "new", days: 30 });
    expect(feed).toHaveLength(0);
  });
});
