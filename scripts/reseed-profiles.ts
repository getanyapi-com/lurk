/**
 * One-off for projects made before 2026-09-19 (PR #73): reads each product page
 * again, drops the "<platform> api" and "<platform> scraper" searches from a
 * product that does not sell platform data, writes the competitors the reading
 * names, and queues the discovery that rebuilds the plan from them. No facts a
 * person edited are touched and no lead is judged again.
 *
 * The discovery jobs are spaced out, because they run on the same workers as a
 * new signup's first sweep. Run it only once the deployed app has PR #73: an
 * older publishDiscoveryPlan deletes the competitors this writes.
 *
 *   npx tsx scripts/reseed-profiles.ts --dry-run
 *   npx tsx scripts/reseed-profiles.ts [--project <id>] [--limit 5] [--gap-seconds 45]
 */
import { existsSync } from "node:fs";

if (existsSync(".env") && !process.env.DATABASE_URL) {
  process.loadEnvFile(".env");
}

const { db } = await import("../src/db");
const schema = await import("../src/db/schema");
const { asc, isNotNull } = await import("drizzle-orm");
const { enqueueJob } = await import("../src/jobs/enqueue");
const { parseTextList } = await import("../src/lib/discovery/store");
const { reseedFromPage } = await import("../src/lib/profile");

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

const dryRun = process.argv.includes("--dry-run");
const only = flag("project");
const limit = Number(flag("limit") ?? Infinity);
const gapMs = Number(flag("gap-seconds") ?? 45) * 1000;

const rows = await db()
  .select()
  .from(schema.projects)
  .where(isNotNull(schema.projects.discoveredAt))
  .orderBy(asc(schema.projects.createdAt));
const chosen = rows.filter((row) => row.url && (!only || row.id === only)).slice(0, limit);
console.log(`${chosen.length} of ${rows.length} set-up projects${dryRun ? " (dry run: nothing is written)" : ""}`);

let queued = 0;
for (const row of chosen) {
  try {
    const result = await reseedFromPage(
      {
        id: row.id,
        userId: row.userId,
        url: row.url!,
        problemPhrasings: parseTextList(row.problemPhrasings),
      },
      { dryRun },
    );
    if (!dryRun) {
      await enqueueJob("discovery_initial", row.id, new Date(Date.now() + queued * gapMs));
      queued += 1;
    }
    console.log(
      `${row.name}: sells platform data ${result.sellsPlatformData}, ` +
        `dropped ${result.droppedPhrasings.length} searches, ` +
        `competitors ${result.competitors.join(", ") || "none"}`,
    );
  } catch (error) {
    // One page that will not load is not a reason to leave the rest as they are.
    console.log(`${row.name}: skipped, ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(dryRun ? "Dry run finished." : `Queued ${queued} discovery jobs, ${gapMs / 1000}s apart.`);
process.exit(0);
