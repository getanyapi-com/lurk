/**
 * PROTOTYPE. Clones a project's plan at a small scale, runs one real backfill
 * on the clone, and samples what the database shows every half second so the
 * live board can be tuned to the real curve.
 *
 *   npx tsx scripts/demo-backfill.ts --from <projectId> --keywords 3 --subreddits 3
 */
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const { db } = await import("../src/db");
const schema = await import("../src/db/schema");
const { eq, sql } = await import("drizzle-orm");
const { runBackfill } = await import("../src/lib/scan/backfill");

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const fromId = flag("from", "");
const keywordCount = Number(flag("keywords", "3"));
const subredditCount = Number(flag("subreddits", "3"));
const existing = flag("project", "");

async function clone(): Promise<string> {
  const [source] = await db().select().from(schema.projects).where(eq(schema.projects.id, fromId));
  if (!source) throw new Error(`no project ${fromId}`);
  const { id: _id, createdAt: _c, ...rest } = source as Record<string, unknown> & { id: string; createdAt: Date };
  const [project] = await db()
    .insert(schema.projects)
    .values({ ...(rest as typeof source), name: `${source.name} demo`, discoveredAt: new Date() })
    .returning();
  const keywords = await db().select().from(schema.projectKeywords).where(eq(schema.projectKeywords.projectId, fromId));
  const subs = await db().select().from(schema.projectSubreddits).where(eq(schema.projectSubreddits.projectId, fromId));
  const pick = <T extends { state: string }>(rows: T[], n: number) => rows.filter((r) => r.state === "active").slice(0, n);
  for (const row of pick(keywords, keywordCount)) {
    const { id: _k, ...k } = row;
    await db().insert(schema.projectKeywords).values({ ...k, projectId: project.id, lastCoveredAt: null, evidence: 0 });
  }
  for (const row of pick(subs, subredditCount)) {
    const { id: _s, ...s } = row;
    await db().insert(schema.projectSubreddits).values({ ...s, projectId: project.id, lastCoveredAt: null, evidence: 0 });
  }
  return project.id;
}

const projectId = existing || (await clone());
console.log("project", projectId);
console.log(`board  http://localhost:3117/prototype/backfill?variant=A&project=${projectId}`);

const [job] = await db()
  .insert(schema.jobs)
  .values({ kind: "backfill", projectId, runAt: new Date(), startedAt: new Date() })
  .returning();

type Sample = { t: number; progress: string | null; judged: number; leads: number; jev: { calls: number; items: number; usd: number; ms: number } };
const samples: Sample[] = [];
const start = Date.now();
const sample = async () => {
  const [[j], [l], [u]] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(schema.leadEvaluations).where(eq(schema.leadEvaluations.projectId, projectId)),
    db().select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(eq(schema.leads.projectId, projectId)),
    db()
      .select({
        calls: sql<number>`count(*)::int`,
        items: sql<number>`coalesce(sum(items_asked),0)::int`,
        usd: sql<number>`coalesce(sum(cost_usd),0)::float`,
        ms: sql<number>`coalesce(sum(latency_ms),0)::int`,
      })
      .from(schema.llmUsage)
      .where(eq(schema.llmUsage.projectId, projectId)),
  ]);
  const [row] = await db().select({ progress: schema.jobs.progress }).from(schema.jobs).where(eq(schema.jobs.id, job.id));
  const s: Sample = { t: Date.now() - start, progress: row?.progress ?? null, judged: j.n, leads: l.n, jev: u };
  samples.push(s);
  const last = samples[samples.length - 2];
  if (!last || last.progress !== s.progress || last.judged !== s.judged || last.leads !== s.leads) {
    console.log(`${(s.t / 1000).toFixed(1)}s  judged=${s.judged} leads=${s.leads} jev=${s.jev.items} items/$${s.jev.usd.toFixed(4)}  ${s.progress ?? ""}`);
  }
};
const timer = setInterval(() => void sample(), 500);

try {
  const outcome = await runBackfill(projectId, job.id);
  await db().update(schema.jobs).set({ finishedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  await sample();
  console.log("outcome", outcome, "in", ((Date.now() - start) / 1000).toFixed(1), "s");
} catch (error) {
  await db().update(schema.jobs).set({ finishedAt: new Date(), error: String(error) }).where(eq(schema.jobs.id, job.id));
  console.error(error);
} finally {
  clearInterval(timer);
  writeFileSync(".context/backfill-samples.json", JSON.stringify({ projectId, samples }, null, 1));
  console.log("wrote .context/backfill-samples.json");
  process.exit(0);
}
