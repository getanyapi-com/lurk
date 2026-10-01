import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { describeDb, makeProject, makeUser } from "./fixtures/db";

/**
 * The sums every cap and run report reads, against a real database because
 * they are SQL. Each narrows to a SKU or purpose no other test writes, so the
 * house-wide totals are this test's own whatever runs beside it.
 */
describeDb("spend", () => {
  it("sums the house's runs and unshared lines, a project's lines and calls, and model calls", async () => {
    const { db } = await import("@/db");
    const { llmUsage, searchRuns, usageLedger, users } = await import("@/db/schema");
    const { houseDataSpend, ledgerCalls, llmSpend, projectLedgerSpend } = await import("@/lib/spend");
    const { utcDayStart } = await import("@/lib/time");
    const { eq, inArray } = await import("drizzle-orm");

    const tag = randomUUID().slice(0, 8);
    const sku = `test.spend.${tag}`;
    const other = `test.other.${tag}`;
    const since = utcDayStart();
    const yesterday = new Date(since.getTime() - 60_000);
    const run = (id: string, fundedBy: string, costUsd: string, fetchedAt = new Date()) => ({
      id,
      kind: "keyword",
      sku,
      normalizedQuery: id,
      costUsd,
      fundedBy,
      fetchedAt,
    });
    const runIds = [`a${tag}`, `b${tag}`, `c${tag}`];

    const user = await makeUser();
    try {
      const project = await makeProject(user.id, { name: "Spend" });
      await db()
        .insert(searchRuns)
        .values([
          run(runIds[0], "house", "0.5"),
          run(runIds[1], "house", "4", yesterday),
          run(runIds[2], "wallet", "8"),
        ]);
      const line = { projectId: project.id, sku, fundedBy: "house" };
      await db()
        .insert(usageLedger)
        .values([
          // The bought run's own line: the run already counts it for the house.
          { ...line, costUsd: "0.5", searchRunId: runIds[0] },
          // A reuse of it, at nothing.
          { ...line, costUsd: "0", searchRunId: runIds[0], reused: true },
          // A call that stores no run, which only the ledger knows about.
          { ...line, costUsd: "0.25" },
          { ...line, sku: other, costUsd: "16" },
        ]);
      await db()
        .insert(llmUsage)
        .values([
          { projectId: project.id, purpose: `judge_${tag}`, costUsd: "0.1" },
          { projectId: project.id, purpose: `seed_${tag}`, costUsd: "0.2" },
        ]);

      expect(await houseDataSpend({ skus: [sku] })).toBeCloseTo(0.75);
      expect(await projectLedgerSpend({ projectId: project.id, since, skus: [sku] })).toBeCloseTo(0.75);
      expect(await projectLedgerSpend({ projectId: project.id, since })).toBeCloseTo(16.75);
      expect(await ledgerCalls({ projectId: project.id, sku, since, boughtOnly: false })).toBe(3);
      expect(await ledgerCalls({ projectId: project.id, sku, since, boughtOnly: true })).toBe(2);
      expect(await llmSpend({ since, projectId: project.id })).toBeCloseTo(0.3);
      expect(await llmSpend({ since, purposes: [`judge_${tag}`] })).toBeCloseTo(0.1);
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
      await db().delete(searchRuns).where(inArray(searchRuns.id, runIds));
    }
  });
});

describe("assertUnderCap", () => {
  it("throws the cap's own error once the spend reaches the cap", async () => {
    const { assertUnderCap } = await import("@/lib/spend");
    class CapError extends Error {
      constructor(readonly capUsd: number) {
        super(`cap ${capUsd}`);
      }
    }
    await expect(assertUnderCap(5, Promise.resolve(4.99), CapError)).resolves.toBeUndefined();
    await expect(assertUnderCap(5, Promise.resolve(5), CapError)).rejects.toEqual(new CapError(5));
  });
});
