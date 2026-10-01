import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { llmUsage } from "@/db/schema";
import { config } from "@/lib/config";
import { LlmCapReachedError } from "@/lib/llm";
import { assertUnderCap, houseDataSpend, ledgerCalls, llmSpend } from "@/lib/spend";
import { utcDayStart } from "@/lib/time";
import { HouseDataCapReachedError } from "@/lib/usage";
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

/** Throws once the house key has spent X's share on twitter.* since midnight UTC, across every project. */
export async function assertXHouseDataUnderCap(): Promise<void> {
  await assertUnderCap(
    config().HOUSE_X_DATA_CAP_USD_PER_DAY,
    houseDataSpend({ skus: X_SKUS }),
    XHouseDataCapError,
  );
}

/** Throws once X's judge, seed and reply calls have cost its share since midnight UTC. */
export async function assertXLlmUnderCap(): Promise<void> {
  await assertUnderCap(
    config().HOUSE_X_LLM_CAP_USD_PER_DAY,
    llmSpend({ since: utcDayStart(), purposes: X_PURPOSES }),
    XLlmCapReachedError,
  );
}

/** Calls this project actually bought (not reused) from one twitter.* SKU since a moment. */
export async function xCallsSince(projectId: string, sku: string, since: Date): Promise<number> {
  return ledgerCalls({ projectId, sku, since, boughtOnly: true });
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
