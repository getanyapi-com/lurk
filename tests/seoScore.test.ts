import { describe, expect, it } from "vitest";
import {
  rankPoints,
  reachPoints,
  scoreBand,
  scoreThread,
  scoreThreads,
  type Scorable,
} from "@/lib/seo/score";
import { orderThreads, worthReplying } from "@/lib/seo/views";
import type { RankingThread } from "@/lib/seo/thread";

/** A thread with nothing remarkable about it, for a test to vary one fact of. */
function thread(over: Partial<RankingThread> = {}): RankingThread {
  return {
    id: over.id ?? "row",
    postId: over.postId ?? "post",
    position: 5,
    competitorPresent: false,
    verdict: null,
    title: "A thread",
    url: "https://www.reddit.com/r/webscraping/comments/x/y/",
    body: null,
    keyword: "reddit scraper",
    snippet: null,
    subreddit: "webscraping",
    subredditIconUrl: null,
    subredditSubscribers: null,
    promoPolicy: null,
    rulesText: null,
    author: null,
    authorAvatarUrl: null,
    authorKarma: null,
    authorCreatedAt: null,
    score: null,
    numComments: null,
    createdAt: new Date(),
    closed: false,
    isArchived: false,
    isLocked: false,
    fit: null,
    intent: null,
    refreshedAt: new Date(),
    ...over,
  };
}

function scorable(over: Partial<Scorable>): Scorable {
  return { position: 5, fit: null, intent: null, score: null, numComments: null, closed: false, ...over };
}

describe("where Google put it", () => {
  it("gives the top spot its own band and nothing to the second page", () => {
    expect([1, 2, 3, 4, 6, 7, 10, 11, 40].map(rankPoints)).toEqual([4, 3, 3, 2, 2, 1, 1, 0, 0]);
  });

  it("scores a thread that no longer carries a position as if it did not rank", () => {
    expect(rankPoints(null)).toBe(0);
  });
});

describe("how many people the thread reaches", () => {
  it("reads the upvotes and the conversation as two halves", () => {
    expect(reachPoints(200, 60)).toBe(4);
    expect(reachPoints(200, 0)).toBe(2);
    expect(reachPoints(0, 60)).toBe(2);
    expect(reachPoints(25, 7)).toBe(2);
    expect(reachPoints(3, 1)).toBe(0);
  });

  it("treats a count Reddit never gave as no reach rather than as an error", () => {
    expect(reachPoints(null, null)).toBe(0);
  });
});

describe("what a ranking thread is worth", () => {
  it("scores the best possible thread at 100 and the worst at 0", () => {
    expect(
      scoreThread(scorable({ position: 1, fit: 4, intent: 4, score: 500, numComments: 90 })).score,
    ).toBe(100);
    expect(scoreThread(scorable({ position: 40, fit: 0, intent: 0 })).score).toBe(0);
  });

  it("puts a strong thread above a well-ranked one nobody is asking in", () => {
    const asking = scoreThread(scorable({ position: 3, fit: 3, intent: 4 }));
    const merelyTop = scoreThread(scorable({ position: 1, fit: 0, intent: 0, score: 500 }));
    expect(asking.score).toBeGreaterThan(merelyTop.score);
    expect(scoreBand(asking)).toBe("strong");
  });

  /**
   * The one rule that overrides every other. A locked thread at #1 with a buyer
   * in it is the most tempting row this tab can draw and the least useful, so
   * the score says zero rather than letting the order argue about it.
   */
  it("scores a closed thread zero however well it ranks", () => {
    const closed = scoreThread(
      scorable({ position: 1, fit: 4, intent: 4, score: 900, numComments: 200, closed: true }),
    );
    expect(closed.score).toBe(0);
    expect(scoreBand(closed)).toBe("closed");
    // The parts are still computed, so the detail can say what it would have been.
    expect(closed.parts).toEqual({ rank: 4, intent: 4, fit: 4, reach: 4 });
  });

  /**
   * A missing judgement counts as zero the way the feed's fold counts it, and
   * that zero must not read as "we looked and there was nobody asking".
   */
  it("marks a thread nothing has judged rather than only scoring it low", () => {
    expect(scoreThread(scorable({ position: 1 })).unjudged).toBe(true);
    expect(scoreThread(scorable({ position: 1, fit: 0, intent: 0 })).unjudged).toBe(false);
  });

  /**
   * The deliberate difference from the leads feed, whose fold spends a fifth of
   * itself on a clock. A thread earns its place here by ranking for months.
   */
  it("scores an old thread and a new one the same", () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    const facts = { position: 2, fit: 3, intent: 3, score: 40, numComments: 12 };
    const old = scoreThreads([thread({ ...facts, createdAt: new Date(Date.now() - 2 * year) })]);
    const fresh = scoreThreads([thread({ ...facts, createdAt: new Date() })]);
    expect(old[0].scored.score).toBe(fresh[0].scored.score);
  });
});

describe("the order the tab is read in", () => {
  const rows = () =>
    scoreThreads([
      thread({ id: "top", position: 1, fit: 0, intent: 0 }),
      thread({ id: "asking", position: 6, fit: 4, intent: 4, score: 200, numComments: 30 }),
      thread({ id: "closed", position: 2, fit: 4, intent: 4, closed: true }),
    ]);

  it("leads with the best opportunity, not with Google's own answer", () => {
    expect(orderThreads(rows(), "score").map((row) => row.id)).toEqual(["asking", "top", "closed"]);
  });

  it("still offers Google's order, and puts the closed thread last in both", () => {
    expect(orderThreads(rows(), "google").map((row) => row.id)).toEqual(["top", "asking", "closed"]);
  });

  /**
   * The order the tab used to have, and its only one. It is kept because a
   * query you are hunting by name is easier to find alphabetically. It is no
   * longer what the tab opens on, and it groups rather than ranks.
   */
  it("groups the table by query when the alphabet is asked for", () => {
    const mixed = scoreThreads([
      thread({ id: "z-good", keyword: "zebra", position: 1, fit: 4, intent: 4 }),
      thread({ id: "a-weak", keyword: "apple", position: 9, fit: 0, intent: 0 }),
      thread({ id: "a-good", keyword: "apple", position: 1, fit: 4, intent: 4 }),
    ]);
    expect(orderThreads(mixed, "alpha").map((row) => row.id)).toEqual([
      "a-good",
      "a-weak",
      "z-good",
    ]);
  });

  /** The one definition of "act on this", which the header count also uses. */
  it("calls a thread worth replying in only once it is strong", () => {
    const [strong, weak] = scoreThreads([
      thread({ position: 1, fit: 4, intent: 4, score: 300, numComments: 40 }),
      thread({ position: 9, fit: 0, intent: 0 }),
    ]);
    expect(worthReplying(strong)).toBe(true);
    expect(worthReplying(weak)).toBe(false);
  });
});
