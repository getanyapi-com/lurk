import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { candidateSources, leads, searchRuns, usageLedger } from "@/db/schema";
import { config } from "./config";
import { assertUnderCap, houseDataSpend, ledgerCalls, llmSpend } from "./spend";
import { utcDayStart } from "./time";

export type SkuUsage = { sku: string; calls: number; costUsd: number; reused: number };

export type UsageToday = {
  calls: number;
  costUsd: number;
  fetched: number;
  reused: number;
  perSku: SkuUsage[];
};

const EMPTY: UsageToday = { calls: 0, costUsd: 0, fetched: 0, reused: 0, perSku: [] };

/** Today's ledger for a set of projects, grouped by SKU. */
export async function usageToday(projectIds: string[]): Promise<UsageToday> {
  if (projectIds.length === 0) {
    return EMPTY;
  }
  const rows = await db()
    .select({
      sku: usageLedger.sku,
      calls: sql<number>`count(*)::int`,
      costUsd: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      reused: sql<number>`count(*) filter (where ${usageLedger.reused})::int`,
    })
    .from(usageLedger)
    .where(and(inArray(usageLedger.projectId, projectIds), gte(usageLedger.at, utcDayStart())))
    .groupBy(usageLedger.sku);

  const perSku: SkuUsage[] = rows.map((row) => ({
    sku: row.sku,
    calls: row.calls,
    costUsd: Number(row.costUsd),
    reused: row.reused,
  }));
  return {
    calls: perSku.reduce((total, row) => total + row.calls, 0),
    costUsd: perSku.reduce((total, row) => total + row.costUsd, 0),
    fetched: perSku.reduce((total, row) => total + row.calls - row.reused, 0),
    reused: perSku.reduce((total, row) => total + row.reused, 0),
    perSku,
  };
}

/** Raised when today's house AnyAPI spend has already reached its ceiling. */
export class HouseDataCapReachedError extends Error {
  constructor(capUsd: number) {
    super(`Today's data budget of $${capUsd.toFixed(2)} is used up. Scans resume tomorrow.`);
    this.name = "HouseDataCapReachedError";
  }
}

/**
 * Throws before a house-funded call that today's budget can no longer cover:
 * what the house key has spent on AnyAPI since midnight UTC, every SKU.
 */
export async function assertHouseDataUnderCap(): Promise<void> {
  await assertUnderCap(
    config().HOUSE_DATA_CAP_USD_PER_DAY,
    houseDataSpend(),
    HouseDataCapReachedError,
  );
}

export type ScanUsage = { calls: number; costUsd: number; reused: number; llmCostUsd: number };

/**
 * What one scan cost: its AnyAPI lines and its language model lines, both read
 * from the moment the scan started. The arithmetic lives here and nowhere else.
 */
export async function usageSince(projectId: string, since: Date): Promise<ScanUsage> {
  const [data] = await db()
    .select({
      calls: sql<number>`count(*)::int`,
      costUsd: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)`,
      reused: sql<number>`count(*) filter (where ${usageLedger.reused})::int`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.projectId, projectId), gte(usageLedger.at, since)));
  const llmCostUsd = await llmSpend({ projectId, since });
  return {
    calls: data?.calls ?? 0,
    costUsd: Number(data?.costUsd ?? 0),
    reused: data?.reused ?? 0,
    llmCostUsd,
  };
}

/**
 * How many Google searches this project has run today, reuses included. A
 * reused search still hands the scan its threads to open, the same as a bought
 * one, so the tier's serpQueriesPerDay counts searches run, not searches bought.
 */
export async function serpCallsToday(projectId: string): Promise<number> {
  return ledgerCalls({ projectId, sku: "google.search", since: utcDayStart(), boughtOnly: false });
}

export type SourceYield = {
  kind: string;
  key: string;
  candidates: number;
  leads: number;
  costUsd: number;
};

/** Which stored run kind each way of finding a candidate is bought through. */
const RUN_KIND: Record<string, string> = {
  search: "keyword",
  scoped: "keyword",
  listing: "subreddit_posts",
  serp: "serp",
};

/**
 * What each source has produced and what it cost, so the retrieval plan can be
 * ranked by fresh leads per dollar rather than by how it was guessed. The cost
 * is the ledger of the runs whose query is that source's own key, which is why
 * a source key is stored as the exact string the fetch asked for.
 */
export async function sourceYield(projectId: string): Promise<SourceYield[]> {
  const produced = await db()
    .select({
      kind: candidateSources.sourceKind,
      key: candidateSources.sourceKey,
      candidates: sql<number>`count(*)::int`,
      leads: sql<number>`count(${leads.id})::int`,
    })
    .from(candidateSources)
    .leftJoin(
      leads,
      and(
        eq(leads.projectId, candidateSources.projectId),
        eq(leads.postId, candidateSources.postId),
        sql`${leads.commentId} is null`,
      ),
    )
    .where(eq(candidateSources.projectId, projectId))
    .groupBy(candidateSources.sourceKind, candidateSources.sourceKey);

  const spent = await db()
    .select({
      kind: searchRuns.kind,
      query: searchRuns.normalizedQuery,
      costUsd: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)`,
    })
    .from(usageLedger)
    .innerJoin(searchRuns, eq(searchRuns.id, usageLedger.searchRunId))
    .where(eq(usageLedger.projectId, projectId))
    .groupBy(searchRuns.kind, searchRuns.normalizedQuery);
  const costs = new Map(spent.map((row) => [`${row.kind} ${row.query}`, Number(row.costUsd)]));

  return produced
    .map((row) => ({
      kind: row.kind,
      key: row.key,
      candidates: row.candidates,
      leads: row.leads,
      costUsd: costs.get(`${RUN_KIND[row.kind] ?? row.kind} ${row.key.toLowerCase()}`) ?? 0,
    }))
    .sort((a, b) => b.leads - a.leads || b.candidates - a.candidates);
}
