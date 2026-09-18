/**
 * Exports one recorded first sweep for the replay at /prototype/backfill: the
 * sampled progress lines from .context/backfill-samples.json plus every found
 * thread, verdict and model call from the database, all timed from the job's
 * start.
 *
 *   npx tsx --env-file=.env scripts/export-backfill-run.ts --project <projectId> > src/app/prototype/backfill/recorded-run.json
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const at = process.argv.indexOf("--project");
const projectId = process.argv[at + 1];
if (!projectId) throw new Error("--project is required");
const samples = JSON.parse(readFileSync(".context/backfill-samples.json", "utf8")) as {
  projectId: string;
  samples: { t: number; progress: string }[];
};
if (samples.projectId !== projectId) throw new Error("samples are for another project");

const sql = postgres(process.env.DATABASE_URL!);
const plain = (s: string | null) => (s === null ? null : s.replace(/\s+/g, " ").trim());
/** Cut by code point, so a cut never leaves half of a pair behind. */
const clip = (s: string | null, n: number) => (s === null ? null : Array.from(s).slice(0, n).join(""));
/** Escaped to ASCII, so no character in a post can break the module this is imported as. */
const ascii = (json: string) =>
  json.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

async function main() {
  const [job] = await sql`select started_at, finished_at from jobs where project_id = ${projectId} and kind = 'backfill' order by run_at desc limit 1`;
  const start = new Date(job.started_at).getTime();
  const usage = await sql`select purpose, items_asked as items, cost_usd::float as usd, at from llm_usage where project_id = ${projectId} and purpose in ('triage', 'score') and at >= ${job.started_at} order by at`;
  const threads = await sql`
    select p.id, p.title, p.subreddit, p.body, p.score as ups, p.num_comments as comments, p.created_at,
      min(c.first_seen_at) as seen, e.judged_at, e.decision, e.score, e.relationship, e.need_state, e.fit, e.intent, e.evidence_quote
    from candidate_sources c join reddit_posts p on p.id = c.post_id
    left join lead_evaluations e on e.project_id = c.project_id and e.post_id = c.post_id and e.comment_id is null
    where c.project_id = ${projectId} and c.first_seen_at >= ${job.started_at}
    group by p.id, e.id order by seen`;
  const out = {
    recordedOn: new Date(start).toISOString().slice(0, 10),
    totalMs: new Date(job.finished_at).getTime() - start,
    samples: samples.samples.map((s) => ({ t: s.t, progress: s.progress })),
    usage: usage.map((u) => ({ t: new Date(u.at).getTime() - start, purpose: u.purpose, items: u.items, usd: u.usd })),
    threads: threads.map((p) => ({
      id: p.id,
      seen: new Date(p.seen).getTime() - start,
      title: plain(p.title),
      subreddit: p.subreddit,
      body: clip(plain(p.body), 220),
      ups: p.ups,
      comments: p.comments,
      createdAt: new Date(p.created_at).toISOString(),
      verdict: p.judged_at
        ? {
            t: new Date(p.judged_at).getTime() - start,
            decision: p.decision,
            score: p.score,
            relationship: p.relationship,
            needState: p.need_state,
            fit: p.fit,
            intent: p.intent,
            quote: plain(p.evidence_quote),
          }
        : null,
    })),
  };
  process.stdout.write(ascii(JSON.stringify(out)));
  await sql.end();
}
main();
