import { and, eq, gte, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import { llmUsage, searchRuns, usageLedger } from "@/db/schema";
import { utcDayStart } from "./time";

/**
 * The spend questions every cap and report asks, each written once. The
 * house's daily caps, X's share of them, a scan's cost and an X run's cost are
 * the same few sums over search_runs, usage_ledger and llm_usage, narrowed by
 * SKU, purpose or project, so a narrowing is an argument here rather than
 * another copy of the query.
 */

/** A numeric sum as Postgres returns it, with nothing to sum read as zero. */
function total(column: AnyColumn) {
  return sql<string>`coalesce(sum(${column}), 0)`;
}

/**
 * What the house key has spent on AnyAPI since midnight UTC, across every
 * project, optionally on some SKUs only: the shared runs, plus the calls that
 * produce no shared run at all, which is the product page read. A reused run
 * costs nothing and is stored as no new run, so nothing is counted twice.
 */
export async function houseDataSpend({ skus }: { skus?: readonly string[] } = {}): Promise<number> {
  const since = utcDayStart();
  const [[runs], [unshared]] = await Promise.all([
    db()
      .select({ total: total(searchRuns.costUsd) })
      .from(searchRuns)
      .where(
        and(
          eq(searchRuns.fundedBy, "house"),
          skus ? inArray(searchRuns.sku, [...skus]) : undefined,
          gte(searchRuns.fetchedAt, since),
        ),
      ),
    db()
      .select({ total: total(usageLedger.costUsd) })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.fundedBy, "house"),
          skus ? inArray(usageLedger.sku, [...skus]) : undefined,
          isNull(usageLedger.searchRunId),
          gte(usageLedger.at, since),
        ),
      ),
  ]);
  return Number(runs?.total ?? 0) + Number(unshared?.total ?? 0);
}

/** What one project's AnyAPI lines have cost since a moment, optionally on some SKUs only. */
export async function projectLedgerSpend({
  projectId,
  since,
  skus,
}: {
  projectId: string;
  since: Date;
  skus?: readonly string[];
}): Promise<number> {
  const [row] = await db()
    .select({ total: total(usageLedger.costUsd) })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        skus ? inArray(usageLedger.sku, [...skus]) : undefined,
        gte(usageLedger.at, since),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * What model calls have cost since a moment: every call the house paid for,
 * or only one project's, or only some purposes. The house pays every model
 * call, so the unnarrowed sum is the house's spend.
 */
export async function llmSpend({
  since,
  purposes,
  projectId,
}: {
  since: Date;
  purposes?: readonly string[];
  projectId?: string;
}): Promise<number> {
  const [row] = await db()
    .select({ total: total(llmUsage.costUsd) })
    .from(llmUsage)
    .where(
      and(
        projectId ? eq(llmUsage.projectId, projectId) : undefined,
        purposes ? inArray(llmUsage.purpose, [...purposes]) : undefined,
        gte(llmUsage.at, since),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * How many ledger lines one project has for one SKU since a moment. Whether a
 * reuse, billed at $0, counts is the caller's to say: `boughtOnly` leaves
 * those out.
 */
export async function ledgerCalls({
  projectId,
  sku,
  since,
  boughtOnly,
}: {
  projectId: string;
  sku: string;
  since: Date;
  boughtOnly: boolean;
}): Promise<number> {
  const [row] = await db()
    .select({ calls: sql<number>`count(*)::int` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        eq(usageLedger.sku, sku),
        boughtOnly ? eq(usageLedger.reused, false) : undefined,
        gte(usageLedger.at, since),
      ),
    );
  return row?.calls ?? 0;
}

/**
 * Throws the cap's own error once what has been spent reaches it. Each cap
 * keeps its own error class, because callers catch them by class: a run that
 * meets one stops rather than reading it as a failed call.
 */
export async function assertUnderCap(
  cap: number,
  spent: Promise<number>,
  CapError: new (capUsd: number) => Error,
): Promise<void> {
  if ((await spent) >= cap) {
    throw new CapError(cap);
  }
}
