import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { llmUsage, searchRuns, usageLedger } from "@/db/schema";
import { config } from "@/lib/config";
import { LlmCapReachedError } from "@/lib/llm";
import { HouseDataCapReachedError, startOfToday } from "@/lib/usage";
import { X_PURPOSES, X_SKUS } from "./constants";

/**
 * X's own share of the house's daily budgets, on top of the global caps every
 * call already passes (fetch.ts buy, llm.ts assertUnderLlmCap). With both set,
 * no amount of X work can spend the money Reddit's scans need: past its share,
 * X waits pending until tomorrow.
 */

/** X has spent its share of today's house data budget. A HouseDataCapReachedError, so every catch of one holds. */
export class XHouseDataCapError extends HouseDataCapReachedError {
  constructor(capUsd: number) {
    super(capUsd);
    this.message = `Today's X data budget of $${capUsd.toFixed(2)} is used up. X resumes tomorrow; Reddit is unaffected.`;
    this.name = "XHouseDataCapError";
  }
}

/**
 * X has spent its share of today's house model budget. A LlmCapReachedError,
 * because judgeX and checkReply rethrow only that class; anything else would be
 * read as an unanswered call and the run would go on asking.
 */
export class XLlmCapReachedError extends LlmCapReachedError {
  constructor(capUsd: number) {
    super(capUsd);
    this.message = `Today's X model budget of $${capUsd.toFixed(2)} is used up. X resumes tomorrow; Reddit is unaffected.`;
    this.name = "XLlmCapReachedError";
  }
}

/** What the house key has spent on twitter.* since midnight UTC, across every project. */
export async function xHouseDataSpendToday(): Promise<number> {
  const since = startOfToday();
  const [runs] = await db()
    .select({ total: sql<string>`coalesce(sum(${searchRuns.costUsd}), 0)` })
    .from(searchRuns)
    .where(
      and(
        eq(searchRuns.fundedBy, "house"),
        inArray(searchRuns.sku, [...X_SKUS]),
        gte(searchRuns.fetchedAt, since),
      ),
    );
  const [unshared] = await db()
    .select({ total: sql<string>`coalesce(sum(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.fundedBy, "house"),
        inArray(usageLedger.sku, [...X_SKUS]),
        isNull(usageLedger.searchRunId),
        gte(usageLedger.at, since),
      ),
    );
  return Number(runs?.total ?? 0) + Number(unshared?.total ?? 0);
}

export async function assertXHouseDataUnderCap(): Promise<void> {
  const cap = config().HOUSE_X_DATA_CAP_USD_PER_DAY;
  if ((await xHouseDataSpendToday()) >= cap) {
    throw new XHouseDataCapError(cap);
  }
}

/** What X's judge and seed calls have cost since midnight UTC. The house pays every model call. */
export async function xLlmSpendToday(): Promise<number> {
  const [row] = await db()
    .select({ total: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)` })
    .from(llmUsage)
    .where(and(inArray(llmUsage.purpose, [...X_PURPOSES]), gte(llmUsage.at, startOfToday())));
  return Number(row?.total ?? 0);
}

export async function assertXLlmUnderCap(): Promise<void> {
  const cap = config().HOUSE_X_LLM_CAP_USD_PER_DAY;
  if ((await xLlmSpendToday()) >= cap) {
    throw new XLlmCapReachedError(cap);
  }
}

/** Calls this project actually bought (not reused) from one twitter.* SKU since a moment. */
export async function xCallsSince(projectId: string, sku: string, since: Date): Promise<number> {
  const [row] = await db()
    .select({ calls: sql<number>`count(*)::int` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.projectId, projectId),
        eq(usageLedger.sku, sku),
        eq(usageLedger.reused, false),
        gte(usageLedger.at, since),
      ),
    );
  return row?.calls ?? 0;
}

/**
 * Answered model calls this project made for one X purpose since a moment, one
 * post per call. A failed call is recorded too, at $0, and must not use up the
 * day's pool: an outage would otherwise stop X leads until midnight. Answered
 * means the call carried its item back: Jev and every X Muse call record
 * items_answered, while a provider's finish reason varies (null, stop, length).
 */
export async function xJudgementsSince(projectId: string, purpose: string, since: Date): Promise<number> {
  const [row] = await db()
    .select({ calls: sql<number>`count(*)::int` })
    .from(llmUsage)
    .where(
      and(
        eq(llmUsage.projectId, projectId),
        eq(llmUsage.purpose, purpose),
        sql`coalesce(${llmUsage.itemsAnswered}, 0) > 0`,
        gte(llmUsage.at, since),
      ),
    );
  return row?.calls ?? 0;
}
