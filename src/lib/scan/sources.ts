import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { candidateSources, projectKeywords, projectSubreddits, searchRuns } from "@/db/schema";
import { normalizeQuery } from "@/lib/reddit/fetch";
import { forgetProjectFeed } from "@/lib/projectFeedCache";
import type { PlanRow, PlanTable, SourceKind } from "./coverage";

/**
 * The plan's bookkeeping: where a candidate came from, when a row's window was
 * last covered, and what each row has produced. Kept apart from the retrieval
 * loop so the loop only decides what to buy.
 */

/** One way a post reached this scan, and the plan rows that are owed credit. */
export type CandidateSource = { kind: SourceKind; key: string; rows: PlanRow[] };

/** A post as retrieval hands it on: its own row, and every source that found it. */
export type SourceRef = { table: PlanTable; id: string };

/**
 * Writes one row per way each candidate was found. A post found by four
 * sources gets four rows, because a per-source count is only honest if every
 * source that produced the post is recorded.
 */
export async function recordSources(
  projectId: string,
  entries: { postId: string; sources: CandidateSource[] }[],
): Promise<number> {
  const values = entries.flatMap((entry) =>
    entry.sources.map((source) => ({
      projectId,
      postId: entry.postId,
      sourceKind: source.kind,
      sourceKey: source.key,
    })),
  );
  if (values.length === 0) {
    return 0;
  }
  const written = await db()
    .insert(candidateSources)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: candidateSources.id });
  // The scan report over the feed counts these, so a scan running while
  // someone watches their feed moves a number this project has already read.
  forgetProjectFeed(projectId);
  return written.length;
}

/** The plan rows a set of sources credits, deduplicated by row. */
export function refsOf(sources: CandidateSource[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const source of sources) {
    for (const row of source.rows) {
      seen.set(`${row.table}:${row.id}`, { table: row.table, id: row.id });
    }
  }
  return [...seen.values()];
}

const TABLES = { keyword: projectKeywords, community: projectSubreddits } as const;

/** Moves a row's watermark forward, which only a covered window may do. */
export async function markCovered(row: PlanRow, at: Date): Promise<void> {
  const table = TABLES[row.table];
  await db().update(table).set({ lastCoveredAt: at }).where(eq(table.id, row.id));
}

/**
 * Adds what this scan learned to the rows that produced it: every judged
 * candidate counts once per row that found it, and every one that became a
 * lead counts again. A post several sources found credits each of them, so the
 * plan can be ranked by what actually produced fresh leads. A post judged twice
 * in one scan, which is what happens when its thread is read, is still one
 * candidate and one lead.
 */
export async function creditSources(
  sourcesByPost: Map<string, CandidateSource[]>,
  judgedPostIds: string[],
  leadPostIds: string[],
): Promise<void> {
  const counts = new Map<string, { ref: SourceRef; candidates: number; leads: number }>();
  const add = (postId: string, field: "candidates" | "leads") => {
    for (const ref of refsOf(sourcesByPost.get(postId) ?? [])) {
      const key = `${ref.table}:${ref.id}`;
      const held = counts.get(key) ?? { ref, candidates: 0, leads: 0 };
      held[field] += 1;
      counts.set(key, held);
    }
  };
  new Set(judgedPostIds).forEach((postId) => add(postId, "candidates"));
  new Set(leadPostIds).forEach((postId) => add(postId, "leads"));
  for (const entry of counts.values()) {
    const table = TABLES[entry.ref.table];
    await db()
      .update(table)
      .set({
        freshCandidates: sql`${table.freshCandidates} + ${entry.candidates}`,
        freshLeads: sql`${table.freshLeads} + ${entry.leads}`,
      })
      .where(eq(table.id, entry.ref.id));
  }
}

/**
 * Keeps searches a first sweep made up and found buyers with, as keywords of
 * the plan, so every scan after it asks them too. `sweep` is their source:
 * discovery did not find them and must not drop them when it publishes a plan
 * (src/lib/discovery/plan.ts). A keyword the project already holds, in any
 * state, is left as it is: a person may have excluded it.
 */
export async function keepSearches(
  projectId: string,
  searches: { text: string; candidates: number; leads: number }[],
): Promise<void> {
  if (searches.length === 0) {
    return;
  }
  await db()
    .insert(projectKeywords)
    .values(
      searches.map((search) => ({
        projectId,
        keyword: search.text,
        source: "sweep",
        state: "active",
        lastCoveredAt: new Date(),
        freshCandidates: search.candidates,
        freshLeads: search.leads,
      })),
    )
    .onConflictDoNothing();
}

/**
 * When each of these queries was last searched over a week or a month. A run of
 * day-wide searches only ever sees the newest posts, so this is what says a
 * query is owed its weekly reconciliation.
 */
export async function lastWideSweeps(queries: string[]): Promise<Map<string, Date>> {
  if (queries.length === 0) {
    return new Map();
  }
  const rows = await db()
    .select({ query: searchRuns.normalizedQuery, fetchedAt: searchRuns.fetchedAt })
    .from(searchRuns)
    .where(
      and(
        eq(searchRuns.kind, "keyword"),
        inArray(searchRuns.normalizedQuery, queries.map(normalizeQuery)),
        inArray(searchRuns.timeframe, ["week", "month"]),
        isNotNull(searchRuns.completedAt),
      ),
    )
    .orderBy(desc(searchRuns.fetchedAt));
  const latest = new Map<string, Date>();
  for (const row of rows) {
    if (!latest.has(row.query)) {
      latest.set(row.query, row.fetchedAt);
    }
  }
  return latest;
}
