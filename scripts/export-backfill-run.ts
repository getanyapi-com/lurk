/**
 * Exports one recorded backfill for the prototype board's replay: the sampled
 * progress from .context/backfill-samples.json plus every verdict and model
 * call from the database, all timed from the job's start.
 *
 *   npx tsx scripts/export-backfill-run.ts --project <projectId> > src/app/prototype/backfill/recorded-run.json
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const at = process.argv.indexOf("--project");
const projectId = process.argv[at + 1];
if (!projectId) throw new Error("--project is required");
const samples = JSON.parse(readFileSync(".context/backfill-samples.json", "utf8")) as {
  projectId: string;
  samples: { t: number; progress: string; judged: number; leads: number }[];
};
if (samples.projectId !== projectId) throw new Error("samples are for another project");

const sql = postgres(process.env.DATABASE_URL!);
const plain = (s: string) => s.replace(/[—–]/g, "-");
async function main() {
  const [job] = await sql`select started_at, finished_at from jobs where project_id = ${projectId} and kind = 'backfill' order by run_at desc limit 1`;
  const start = new Date(job.started_at).getTime();
  const totalMs = new Date(job.finished_at).getTime() - start;
  const usage = await sql`select purpose, items_asked as items, cost_usd::float as usd, latency_ms as ms, at from llm_usage where project_id = ${projectId} order by at`;
  const posts = await sql`
    select e.judged_at, p.title, p.subreddit, p.created_at, e.relationship, e.need_state, e.decision, e.score, e.fit, e.intent, e.evidence_quote, l.stage
    from lead_evaluations e join reddit_posts p on p.id = e.post_id
    left join leads l on l.project_id = e.project_id and l.post_id = e.post_id and l.comment_id is null
    where e.project_id = ${projectId} and e.comment_id is null order by e.judged_at`;
  const found = (s: string) => Number(/(\d+) posts found/.exec(s)?.[1] ?? 0);
  const phase = (s: string) => (s.startsWith("First pass") ? "first" : s.startsWith("Reading the rest") ? "rest" : s.startsWith("Scoring") ? "scoring" : "done");
  const search = samples.samples.map((s) => ({ t: s.t, phase: phase(s.progress), found: found(s.progress) }));
  const firstPassEndsAt = search.find((s) => s.phase !== "first")?.t ?? totalMs;
  const searchEndsAt = search.find((s) => s.phase === "scoring" || s.phase === "done")?.t ?? totalMs;
  const out = {
    recordedOn: new Date(start).toISOString().slice(0, 10),
    totalMs,
    found: Math.max(...search.map((s) => s.found)),
    firstPassEndsAt,
    searchEndsAt,
    search,
    usage: usage.map((u) => ({ t: new Date(u.at).getTime() - start, purpose: u.purpose, items: u.items, usd: u.usd, ms: u.ms })),
    posts: posts.map((p) => ({
      t: new Date(p.judged_at).getTime() - start,
      title: plain(p.title),
      subreddit: p.subreddit,
      monthsAgo: Math.floor((start - new Date(p.created_at).getTime()) / (30 * 24 * 3600 * 1000)),
      relationship: p.relationship,
      needState: p.need_state,
      decision: p.decision,
      score: p.score,
      fit: p.fit,
      intent: p.intent,
      quote: p.evidence_quote ? plain(p.evidence_quote) : null,
      stage: p.stage,
    })),
  };
  process.stdout.write(JSON.stringify(out));
  await sql.end();
}
main();
