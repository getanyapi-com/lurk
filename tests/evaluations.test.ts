import { describe, expect, it, vi } from "vitest";
import { SCORE_BATCH_SIZE } from "@/lib/scan/constants";
import { leadKey } from "@/lib/scan/leads";
import { judgeAnswers, product } from "./jevAnswers";
import {
  alreadyJudged,
  contentHash,
  digestComments,
  postHash,
} from "@/lib/scan/evaluations";

/**
 * What a stored verdict is worth on the next scan, and what a thread is read
 * for. The scan module pulls in the model client, so it is imported after the
 * mock the way the rest of the suite does it.
 */

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));

vi.mock("@/lib/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jev")>()),
  askJev,
}));

const { judgeThreads, representativeComments, verificationText } = await import(
  "@/lib/scan/comments"
);

describe("reusing a stored verdict", () => {
  const stored = new Map([[leadKey("abc", null), { profileVersion: 3, contentHash: "hash" }]]);

  it("skips a candidate whose text and product profile are both unchanged", () => {
    expect(alreadyJudged(stored, leadKey("abc", null), 3, "hash")).toBe(true);
  });

  it("judges it again after a profile edit", () => {
    expect(alreadyJudged(stored, leadKey("abc", null), 4, "hash")).toBe(false);
  });

  it("judges it again once its text has changed", () => {
    expect(alreadyJudged(stored, leadKey("abc", null), 3, "other")).toBe(false);
  });

  it("has never seen a candidate it holds no verdict for", () => {
    expect(alreadyJudged(stored, leadKey("def", null), 3, "hash")).toBe(false);
  });

  it("hashes only the text a verdict was made on", () => {
    expect(postHash("t", "b", digestComments([]))).toBe(postHash("t", "b", digestComments([])));
    expect(postHash("t", "b", digestComments([]))).not.toBe(
      postHash("t", "b", digestComments([{ id: "c1", body: "new reply" }])),
    );
  });

  it("reads a thread the same whatever order its comments arrive in", () => {
    const one = [
      { id: "c1", body: "first" },
      { id: "c2", body: "second" },
    ];
    expect(digestComments(one)).toBe(digestComments([...one].reverse()));
  });

  it("separates a comment's verdict from its parent post's", () => {
    expect(contentHash(["title", "parent", "comment"])).not.toBe(
      contentHash(["title", null, "parent comment"]),
    );
  });
});

describe("what a thread is read for", () => {
  const post = {
    id: "p1",
    author: "asker",
    title: "Need a form tool",
    body: "Our signup form needs conditional logic.",
    subreddit: "SaaS",
    numComments: 3,
    score: 4,
    createdAt: new Date(),
  } as never as import("@/lib/reddit/store").StoredPost;

  function comment(patch: Record<string, unknown>) {
    return {
      id: "c1",
      postId: "p1",
      author: "someone",
      body: "text",
      score: 1,
      permalink: null,
      parentId: null,
      raw: null,
      createdAt: new Date(),
      fetchedAt: new Date(),
      ...patch,
    } as never as import("@/lib/reddit/store").StoredComment;
  }

  it("gives the post its author's follow-ups and the answers others gave", () => {
    const text = verificationText({
      post,
      comments: [
        comment({ id: "c1", author: "asker", body: "We went with Formcraft, thanks." }),
        comment({ id: "c2", author: "helper", body: "Try Formcraft." }),
      ],
    });
    expect(text).toContain("We went with Formcraft, thanks.");
    expect(text).toContain("u/helper: Try Formcraft.");
    expect(text).toContain("Our signup form needs conditional logic.");
  });

  it("verifies a thread with one reply, because one reply can end it", () => {
    const text = verificationText({
      post,
      comments: [comment({ author: "asker", body: "Solved." })],
    });
    expect(text).toContain("Solved.");
  });

  it("turns one author's four comments into one opportunity", () => {
    const kept = representativeComments({
      post,
      comments: [
        comment({ id: "c1", author: "buyer", body: "short" }),
        comment({ id: "c2", author: "buyer", body: "the longer one with the actual need" }),
        comment({ id: "c3", author: "asker", body: "the post author replying" }),
      ],
    });
    expect(kept.map((one) => one.id)).toEqual(["c2"]);
  });
});

describe("judging one comment once", () => {
  const project = {
    id: "project-1",
    userId: "user-1",
    name: "Formcraft",
    threshold: 50,
    profileVersion: 1,
    queries: [],
    communities: [],
    keywords: [],
    subreddits: [],
    phrasings: [],
    competitors: [],
    destinations: [],
    product,
    productText: "Product: Formcraft",
  };

  function post(id: string) {
    return {
      id,
      author: "asker",
      title: "Need a form tool",
      body: "Our signup form needs conditional logic.",
      subreddit: "SaaS",
      numComments: 3,
      score: 4,
      createdAt: new Date(),
    } as never as import("@/lib/reddit/store").StoredPost;
  }

  function reply(postId: string, id = "shared-comment") {
    return {
      id,
      postId,
      author: `buyer-${id}`,
      body: "I need conditional logic on my own signup form too.",
      score: 1,
      permalink: null,
      parentId: null,
      raw: null,
      createdAt: new Date(),
      fetchedAt: new Date(),
    } as never as import("@/lib/reddit/store").StoredComment;
  }

  /**
   * An upstream that answers a crosspost with the original thread's replies
   * hands the same comment back under a second post, and a comment keeps the
   * post it was first stored under, so both threads carry it.
   */
  it("gives a comment two threads carry one verdict and one model call", async () => {
    askJev.mockReset();
    askJev.mockImplementation(async (call: { itemsAsked: number }) =>
      judgeAnswers(Array.from({ length: call.itemsAsked }, () => ({ quote: "s0" }))),
    );

    const judged = await judgeThreads(
      project,
      [
        {
          post: post("p1"),
          comments: [
            reply("p1"),
            ...Array.from({ length: SCORE_BATCH_SIZE }, (_, index) =>
              reply("p1", `other-${index}`),
            ),
          ],
        },
        { post: post("p2"), comments: [reply("p1")] },
      ],
      new Map(),
    );

    const commentIds = judged.records
      .filter((record) => record.commentId !== null)
      .map((record) => record.commentId);
    expect(commentIds.filter((id) => id === "shared-comment")).toEqual(["shared-comment"]);
    expect(new Set(commentIds).size).toBe(commentIds.length);
    const asked = askJev.mock.calls
      .map((call) => call[0])
      .filter((call) => call.purpose === "score")
      .reduce((total, call) => total + call.itemsAsked, 0);
    // The two posts and one call's worth of each distinct comment, never two
    // for the comment both threads carry.
    expect(asked).toBe(SCORE_BATCH_SIZE + 3);
  });
});
