import { describe, expect, it, vi } from "vitest";

/**
 * The key a shared fetch is stored under is what lets the next caller reuse
 * it, so a key that drifts quietly buys every answer again: the runs already
 * stored stop matching and nothing fails. These pin the keys exactly, and what
 * each call asks upstream, with only `fetchShared` faked.
 */

type SharedInput = {
  kind: string;
  sku: string;
  normalizedQuery: string;
  sort?: string | null;
  timeframe?: string | null;
  variant?: string;
  maxAgeMs?: number;
  run: () => Promise<{ data: unknown; costUsd: number }>;
};

const keys: SharedInput[] = [];

vi.mock("@/lib/reddit/fetch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reddit/fetch")>("@/lib/reddit/fetch");
  return {
    ...actual,
    fetchShared: async (input: SharedInput) => {
      keys.push(input);
      await input.run();
      return { value: [], reused: false, costUsd: 0 };
    },
  };
});

/** A context whose client records what each SDK method was asked. */
function recordingContext() {
  const asked: { method: string; input: Record<string, unknown> }[] = [];
  const answer = (method: string) => async (input: Record<string, unknown>) => {
    asked.push({ method, input });
    return { output: { found: false as const }, costUsd: 0 };
  };
  const ctx = {
    projectId: "p",
    maxAgeMs: 60 * 60 * 1000,
    funded: {
      funding: "house" as const,
      call: async <T>(fn: () => Promise<T>) => ({ result: await fn(), requestId: null }),
      client: {
        reddit: { post: answer("reddit.post") },
        google: { search: answer("google.search") },
      },
    },
  };
  return { ctx: ctx as never, asked };
}

/**
 * Google is asked two ways, and production already holds runs under each
 * way's key: the feed's, with its week and its market in the key, and the one
 * discovery and the SEO refresh share, with neither. Both must stay exactly as
 * stored or every run in the reuse window is bought again.
 */
describe("google.search's run keys", () => {
  it("keys the feed's search on its week and its market, and asks Google for the week", async () => {
    const { googleSearch } = await import("@/lib/seo/fetch");
    const { FEED_TIMEFRAME } = await import("@/lib/scan/coverage");
    const { ctx, asked } = recordingContext();
    keys.length = 0;
    await googleSearch(ctx, "  Typeform Alternative reddit ", { timeframe: FEED_TIMEFRAME });
    expect(FEED_TIMEFRAME).toBe("7d");
    expect(keys[0]).toMatchObject({
      kind: "serp",
      sku: "google.search",
      normalizedQuery: "typeform alternative reddit",
      timeframe: "7d",
      variant: "gl=us&hl=en",
    });
    expect(keys[0].sort ?? null).toBeNull();
    expect(keys[0].maxAgeMs).toBeUndefined();
    expect(asked).toEqual([
      {
        method: "google.search",
        input: { query: "  Typeform Alternative reddit ", gl: "us", hl: "en", timeframe: "7d" },
      },
    ]);
  });

  it("keys discovery's search with no timeframe and no variant, and asks for a fast source", async () => {
    const { runDiscoveryQueries } = await import("@/lib/discovery/serp");
    const { ctx, asked } = recordingContext();
    keys.length = 0;
    await runDiscoveryQueries(ctx, [
      { query: "Typeform Alternative reddit", family: "f", destination: null, kind: "problem" },
    ]);
    expect(keys[0]).toMatchObject({
      kind: "serp",
      sku: "google.search",
      normalizedQuery: "typeform alternative reddit",
    });
    expect(keys[0].timeframe ?? null).toBeNull();
    expect(keys[0].variant ?? "").toBe("");
    expect(keys[0].sort ?? null).toBeNull();
    expect(keys[0].maxAgeMs).toBeUndefined();
    expect(asked).toEqual([
      {
        method: "google.search",
        input: { query: "Typeform Alternative reddit", gl: "us", hl: "en", preferLatencyUnderMs: 1000 },
      },
    ]);
  });
});

describe("reddit.post's run key", () => {
  it("is the post id however the thread's URL is spelled, and Reddit gets the URL as given", async () => {
    const { fetchPost } = await import("@/lib/reddit/skus");
    const spellings = [
      "https://www.reddit.com/r/SaaS/comments/abc123/",
      "https://www.reddit.com/r/SaaS/comments/abc123/best_form_builder/",
      "https://old.reddit.com/r/SaaS/comments/abc123/best_form_builder/?utm_source=google",
    ];
    for (const url of spellings) {
      const { ctx, asked } = recordingContext();
      keys.length = 0;
      await fetchPost(ctx, url, 1000);
      expect(keys[0]).toMatchObject({ kind: "post", sku: "reddit.post", normalizedQuery: "abc123" });
      expect(asked).toEqual([{ method: "reddit.post", input: { url } }]);
    }
  });

  it("falls back to the URL itself for a link that is not a thread", async () => {
    const { fetchPost } = await import("@/lib/reddit/skus");
    const { ctx } = recordingContext();
    keys.length = 0;
    await fetchPost(ctx, "https://example.com/a-post", 1000);
    expect(keys[0].normalizedQuery).toBe("https://example.com/a-post");
  });
});
