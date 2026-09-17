import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchContext } from "@/lib/reddit/fetch";
import type { StoredPost } from "@/lib/reddit/store";
import type { PlanRow } from "@/lib/scan/coverage";
import type { ScanProject } from "@/lib/scan/project";
import { TIERS } from "@/lib/tiers";

/**
 * When a covered window's watermark is allowed to move. Retrieval finding the
 * posts is not enough: a scan that dies between the fetch and the verdict must
 * ask for the same window again, so retrieve only reports what it covered and
 * the caller marks it after the judgements are written.
 */

const fetchSearch = vi.fn();
const fetchSubredditPosts = vi.fn();
const fetchPost = vi.fn();
const fetchFeedThreads = vi.fn();
const markCovered = vi.fn();
const recordSources = vi.fn();
const lastWideSweeps = vi.fn();
const serpCallsToday = vi.fn();

vi.mock("@/lib/reddit/skus", () => ({ fetchSearch, fetchSubredditPosts, fetchPost }));
vi.mock("@/lib/scan/serp", () => ({ fetchFeedThreads, FEED_TIMEFRAME: "7d" }));
vi.mock("@/lib/scan/sources", () => ({ markCovered, recordSources, lastWideSweeps }));
vi.mock("@/lib/usage", () => ({ serpCallsToday }));

const { retrieve } = await import("@/lib/scan/retrieve");

const NOW = new Date("2026-09-06T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const query: PlanRow = {
  evidence: 0,
  id: "keyword-1",
  table: "keyword",
  key: "form builder",
  source: "user",
  state: "active",
  lastCoveredAt: new Date(NOW.getTime() - 12 * HOUR),
};

const post = {
  id: "p1",
  subreddit: "SaaS",
  author: "asker",
  title: "Looking for a form builder with conditional logic",
  body: "Our signup form needs conditional logic.",
  url: "https://www.reddit.com/r/SaaS/comments/p1/form/",
  score: 3,
  numComments: 2,
  createdAt: new Date(NOW.getTime() - HOUR),
} as unknown as StoredPost;

const project = {
  id: "project-1",
  queries: [query],
  communities: [],
} as unknown as ScanProject;

describe("the watermark a scan's retrieval has earned", () => {
  beforeEach(() => {
    for (const mock of [fetchSearch, fetchSubredditPosts, fetchPost, fetchFeedThreads]) {
      mock.mockReset();
    }
    markCovered.mockReset();
    recordSources.mockReset();
    lastWideSweeps.mockReset();
    serpCallsToday.mockReset();
    lastWideSweeps.mockResolvedValue(new Map([[query.key.toLowerCase(), NOW]]));
    recordSources.mockResolvedValue(0);
    serpCallsToday.mockResolvedValue(1000);
    fetchSearch.mockResolvedValue({ value: { posts: [post], nextCursor: null } });
  });

  it("reports the window it covered instead of moving the watermark itself", async () => {
    const result = await retrieve({
      project,
      ctx: {} as FetchContext,
      limits: null,
      windowMs: 30 * 24 * HOUR,
      intervalHours: 6,
      hydration: null,
      now: NOW,
    });

    expect(result.candidates.map((candidate) => candidate.post.id)).toEqual([post.id]);
    expect(markCovered).not.toHaveBeenCalled();
    expect(result.covered).toEqual([{ row: query, at: NOW }]);
  });
});

/**
 * A scan buys fewer searches than a plan holds rows. Which rows it buys was
 * decided by staleness alone, so a search whose results the model called
 * relevant six times waited behind one it called relevant three times.
 */
describe("which rows a scan's budget buys", () => {
  beforeEach(() => {
    for (const mock of [fetchSearch, fetchSubredditPosts, fetchPost, fetchFeedThreads]) {
      mock.mockReset();
    }
    markCovered.mockReset();
    recordSources.mockReset();
    recordSources.mockResolvedValue(0);
    lastWideSweeps.mockReset();
    lastWideSweeps.mockResolvedValue(new Map());
    serpCallsToday.mockReset();
    serpCallsToday.mockResolvedValue(1000);
    fetchSearch.mockResolvedValue({ value: { posts: [], nextCursor: null } });
  });

  it("searches the row with the most relevant evidence, not the stalest", async () => {
    const row = (key: string, evidence: number, coveredHoursAgo: number): PlanRow => ({
      id: key,
      table: "keyword",
      key,
      source: "serp",
      state: "active",
      lastCoveredAt: new Date(NOW.getTime() - coveredHoursAgo * HOUR),
      evidence,
    });
    await retrieve({
      project: {
        id: "project-2",
        queries: [row("ahrefs api", 3, 48), row("instagram api", 6, 1)],
        communities: [],
      } as unknown as ScanProject,
      ctx: {} as FetchContext,
      // One search, so the budget has to choose between the two rows.
      limits: { ...TIERS.free, searchesPerScan: 1, serpQueriesPerDay: 0 },
      windowMs: 30 * 24 * HOUR,
      intervalHours: 6,
      hydration: null,
      now: NOW,
    });

    expect(fetchSearch).toHaveBeenCalledTimes(1);
    expect(fetchSearch.mock.calls[0][1]).toBe("instagram api");
  });
});
