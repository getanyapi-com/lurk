import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { signalsFrom } from "../src/lib/x/judge";
import type { Answers } from "../src/lib/jev";
import type { SnapshotPost } from "../src/lib/x/audit-eval";
import { configHash } from "../src/lib/x/audit";

/** Explicit read-only export of the LOCAL audit copies; never scans or buys data. */
export async function exportSnapshot(args: string[]) {
  const tag = args[args.indexOf("--tag") + 1];
  if (!args.includes("--tag") || !tag || !/^[\w-]+$/u.test(tag)) throw new Error("--tag is required");
  const dir = join(".context", "x-audit", tag);
  const target = join(dir, "snapshot.json");
  if (existsSync(target)) throw new Error("snapshot already frozen; preserve it or use a new tag");
  const setup = JSON.parse(readFileSync(join(dir, "setup.json"), "utf8"));
  const samplingPath = join(dir, "sampling.json");
  const sampling = existsSync(samplingPath) ? JSON.parse(readFileSync(samplingPath, "utf8")) : null;
  if (sampling && (sampling.version !== 2 || sampling.setupHash !== setup.hash)) throw new Error("sampling/setup mismatch");
  const from = sampling?.from ?? setup.from ?? setup.start;
  const until = sampling?.until ?? null;
  if (existsSync(".env")) process.loadEnvFile(".env");
  const database = process.env.DATABASE_URL;
  if (!database || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(database).hostname)) {
    throw new Error("snapshot requires a loopback LOCAL database; remote databases are not supported");
  }
  const sql = postgres(database, { max: 1 });
  try {
    const posts = await sql.begin("isolation level repeatable read read only", async (tx) => {
      const out: SnapshotPost[] = [];
      for (const product of setup.products) {
        const rows = await tx`
          select e.tweet_id, e.project_id, e.stage, e.free_reject, e.reason_code, e.score, e.level,
                 e.signals, e.need_quote, e.context, l.family, l.label, l.terms,
                 p.text, p.author_username, p.created_at, p.conversation_id, p.is_reply
          from x_evaluations e join x_posts p on p.id = e.tweet_id
          left join x_lanes l on l.id = e.lane_id
          where e.project_id in (${product.copies.baseline}, ${product.copies.probe})
            and p.created_at >= ${from}::timestamptz
            ${until ? tx`and p.created_at < ${until}::timestamptz` : tx``}
          order by e.tweet_id, e.project_id
        `;
        const byTweet = new Map<string, SnapshotPost>();
        for (const row of rows) {
          const post: SnapshotPost = byTweet.get(row.tweet_id) ?? {
            key: `${product.source}:${row.tweet_id}`, product: product.name, tweet: row.tweet_id,
            text: row.text, author: row.author_username, created: row.created_at.toISOString(),
            conversation: row.conversation_id, isReply: row.is_reply, arms: {},
          };
          let signals = null;
          if (row.signals) {
            try { signals = signalsFrom(row.signals as Answers, row.level === "complete" ? "complete" : "search"); }
            catch { /* Missing answers stay unknown, never fabricated zeroes. */ }
          }
          const arm = row.project_id === product.copies.baseline ? "baseline" : "probe";
          post.arms[arm] = {
            stage: row.stage, freeReject: row.free_reject, reasonCode: row.reason_code, score: row.score,
            lane: row.terms ? { family: row.family, label: row.label, terms: row.terms } : null,
            signals, level: row.level, needQuote: row.need_quote,
            chainIncomplete: row.context?.chainIncomplete ?? null,
          };
          byTweet.set(row.tweet_id, post);
        }
        out.push(...byTweet.values());
      }
      return out;
    });
    const frozen = { version: 1, setupHash: setup.hash, from, until, exportedAt: new Date().toISOString(),
      provenance: "read-only local database; current stored evaluation state, not a historical event log", posts };
    writeFileSync(target, JSON.stringify({ ...frozen, contentHash: configHash(frozen) }));
    console.log(`frozen ${posts.length} product/posts at ${target}`);
  } finally { await sql.end(); }
}
