import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { serpResults } from "@/db/schema";
import {
  fetchShared,
  normalizeQuery,
  type FetchContext,
  type FetchKind,
  type SharedResult,
} from "@/lib/reddit/fetch";
import { redditResults, type GoogleResult } from "./links";

export type StoredResult = typeof serpResults.$inferSelect;

/** The search_runs kind for a Google search. */
const GOOGLE_KIND: FetchKind = "serp";

/** Every Google search this app makes asks for United States results. */
export const SEO_GEO = "us";

/** And asks for them in English, which is also Google's own default. */
export const SEO_LANGUAGE = "en";

/**
 * What we actually send Google, wherever the question comes from: the words a
 * buyer would type, with "reddit" after them. It is what a person searching
 * for a thread actually types, and Google answers it with mostly Reddit, so
 * every caller asks the one question and they share one paid run between them.
 *
 * Measured 2026-09-14 over five phrasings: `site:reddit.com/r/` returns 9 or
 * 10 threads of 10 results against this form's 6 or 7 of 9, so the operator is
 * the denser form per call. It is not the better one. The two forms answer
 * from different slices - this one found 12 threads the operator missed across
 * those five - and everything discovery buys is labelled for relevance before
 * it can reach a plan, so a thread that does not belong costs a label and
 * nothing else.
 */
export function googleQuery(keyword: string): string {
  return `${keyword.trim()} reddit`;
}

async function storeResults(data: unknown, runId: string): Promise<StoredResult[]> {
  const results = ((data as { results?: GoogleResult[] } | null)?.results ?? []) as GoogleResult[];
  const threads = redditResults(results);
  if (threads.length === 0) {
    return [];
  }
  return db()
    .insert(serpResults)
    .values(
      threads.map((thread) => ({
        id: randomUUID(),
        searchRunId: runId,
        position: thread.position,
        url: thread.link,
        title: thread.title ?? null,
        snippet: thread.snippet ?? null,
      })),
    )
    .returning();
}

function loadResults(runId: string): Promise<StoredResult[]> {
  return db()
    .select()
    .from(serpResults)
    .where(eq(serpResults.searchRunId, runId))
    .orderBy(asc(serpResults.position));
}

/**
 * The one Google search this app makes, wherever it is asked from. Every call
 * asks for the same market - United States results in English, no city and no
 * time restriction - so two callers asking the same question share one run and
 * pay once. Non-Reddit results are dropped before they are stored, so the whole
 * app only ever holds the links it can open through reddit.post.
 */
export async function fetchGoogleThreads(
  ctx: FetchContext,
  query: string,
  maxAgeMs: number,
): Promise<SharedResult<StoredResult[]>> {
  return fetchShared<StoredResult[]>({
    ctx,
    kind: GOOGLE_KIND,
    sku: "google.search",
    normalizedQuery: normalizeQuery(query),
    maxAgeMs,
    run: async () => {
      const res = await ctx.funded.client.google.search({
        query,
        gl: SEO_GEO,
        hl: SEO_LANGUAGE,
      });
      return { data: res.output.found ? res.output.data : null, costUsd: res.costUsd };
    },
    store: storeResults,
    load: loadResults,
  });
}

/** The Reddit threads Google ranks for one of this project's SEO keywords. */
export async function fetchRankingThreads(
  ctx: FetchContext,
  keyword: string,
  maxAgeMs: number,
): Promise<SharedResult<StoredResult[]>> {
  return fetchGoogleThreads(ctx, googleQuery(keyword), maxAgeMs);
}
