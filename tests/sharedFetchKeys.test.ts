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
