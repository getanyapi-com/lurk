/**
 * The X recall and precision audit: where the X pipeline finds and loses
 * leads, product by product, so a change to the searches, the screen or the
 * judge is chosen from evidence and measured on weeks it was not tuned on.
 * The logic it reads with is src/lib/x/audit.ts; this file runs it.
 *
 * Each product is copied twice in the local database and scanned by the real
 * runXScan: the baseline copy on the searches lurk writes for it, the probe
 * copy on fixed broad searches built from the same facts. Run it on a schedule
 * after `setup` freezes everything, label the union blind, then report:
 *
 *   npm run x:audit -- setup  --tag oct --products <id,id,...>
 *   npm run x:audit -- run    --tag oct              (daily; both arms, every product)
 *   npm run x:audit -- sample --tag oct              (writes to-label.jsonl, blind, and LABELLING.md)
 *   (label it: people or Claude agents, by LABELLING.md, into labels.jsonl)
 *   npm run x:audit -- snapshot --tag oct          (local DB, read-only export)
 *   npm run x:audit -- offline --tag oct           (files only; report is an alias)
 *
 * `sample` and `snapshot` use the frozen setup window. `offline` reads
 * only the saved sample, labels and snapshot; it never loads .env or scans.
 *
 * A backfill reads a past week at once instead of waiting for one:
 *
 *   npm run x:audit -- setup --tag oct-wk --products <ids> --lookback 7
 *   npm run x:audit -- run   --tag oct-wk --pages 10   (once; each search pages up to 10 deep)
 *
 * It reads posts written before the arms were frozen, so it is fair only on
 * products whose searches and probe were not tuned on that week.
 *
 * Everything lands in .context/x-audit/<tag>/: customers' posts, never the repo.
 * `setup` may buy seed slots; `run` buys searches, lookups and model calls.
 * These live commands require separate spend authorization. `sample` reads
 * DB state; `snapshot` exports local state; `offline` makes no network calls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Offline analysis never loads credentials, a database client, or the scan.
if (process.argv[2] === "offline" || process.argv[2] === "report") {
  const { runOffline } = await import("./x-audit-offline");
  await runOffline(process.argv.slice(3));
  process.exit(0);
}

if (process.argv[2] === "snapshot") {
  const { exportSnapshot } = await import("./x-audit-snapshot");
  await exportSnapshot(process.argv.slice(3));
  process.exit(0);
}

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
process.env.X_LEADS = "true";

const { sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const { loadScanProject } = await import("../src/lib/scan/project");
const { compileLanes, lanesInputHash, rivalSeeds } = await import("../src/lib/x/lanes");
const { seedSlotsFor } = await import("../src/lib/x/seeds");
const { domainLabel, markLanesDue, runXScan } = await import("../src/lib/x/run");
const { slug } = await import("../src/lib/x/words");
const audit = await import("../src/lib/x/audit");

type Arm = "baseline" | "probe";
type LaneRecord = { label: string; family: string; terms: string[][]; body: string };
type ProductSetup = {
  source: string;
  name: string;
  copies: Record<Arm, string>;
  lanes: Record<Arm, LaneRecord[]>;
  probeTerms: string[];
};
/** `from`: where audited posts start, the setup time or, on a backfill, `lookbackDays` before it. */
type Setup = { tag: string; probeVersion: string; start: string; from?: string; lookbackDays?: number; hash: string; products: ProductSetup[] };

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const command = process.argv[2];
const tag = flag("tag");
if (!tag || !/^[\w-]+$/u.test(tag)) throw new Error("--tag <letters, digits, dashes> is required");
const dir = join(".context", "x-audit", tag);
const setupPath = join(dir, "setup.json");

function readSetup(): Setup {
  if (!existsSync(setupPath)) throw new Error(`no setup at ${setupPath}; run setup first`);
  return JSON.parse(readFileSync(setupPath, "utf8")) as Setup;
}

type Row = Record<string, unknown>;
async function rows<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db().execute(query);
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

async function columnsOf(table: string): Promise<string[]> {
  const found = await rows<{ column_name: string }>(
    sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`,
  );
  return found.map((row) => row.column_name);
}

/** Copies one table's rows from one project to another, every column but the id and the project. */
async function copyRows(table: string, from: string, to: string) {
  const columns = (await columnsOf(table)).filter((column) => column !== "id" && column !== "project_id");
  const list = columns.map((column) => `"${column}"`).join(", ");
  await db().execute(
    sql.raw(`insert into "${table}" ("id", "project_id", ${list}) select gen_random_uuid()::text, '${to}', ${list} from "${table}" where project_id = '${from}'`),
  );
}

/** A copy of a project: its row (same name, so own-name rules behave), its plan rows, and its X state. */
async function copyProject(source: string): Promise<string> {
  const [{ id }] = await rows<{ id: string }>(sql`select gen_random_uuid()::text as id`);
  const columns = (await columnsOf("projects")).filter((column) => column !== "id");
  const list = columns.map((column) => `"${column}"`).join(", ");
  await db().execute(sql.raw(`insert into projects ("id", ${list}) select '${id}', ${list} from projects where id = '${source}'`));
  for (const table of ["project_competitors", "project_keywords", "project_subreddits"]) {
    await copyRows(table, source, id);
  }
  await db().execute(
    sql`insert into x_projects (project_id, enabled_at, last_opened_at, alerts, seeds)
        select ${id}, now(), now(), false, seeds from x_projects where project_id = ${source}`,
  );
  return id;
}

/**
 * Lanes written as already watching from now: one run behind them and covered
 * up to the start, so the first audited pass reads only what is new, as a
 * project long past its first look does, instead of the month a new lane reads.
 */
async function insertLanes(projectId: string, lanes: LaneRecord[], seeds: (index: number) => string[], start: Date) {
  for (const [rank, lane] of lanes.entries()) {
    await db().execute(sql`
      insert into x_lanes (id, project_id, family, seeds, terms, label, rank, body, state, runs, covered_until, created_at)
      values (gen_random_uuid()::text, ${projectId}, ${lane.family},
              array(select jsonb_array_elements_text(${JSON.stringify(seeds(rank))}::jsonb)), ${JSON.stringify(lane.terms)}::jsonb,
              ${lane.label}, ${rank}, ${lane.body}, 'active', 1, ${start.toISOString()}::timestamptz, ${start.toISOString()}::timestamptz)
    `);
  }
  // A finished searching run before today, so no pass of this copy is its first look.
  await db().execute(sql`
    insert into x_runs (id, project_id, started_at, finished_at, lanes_run)
    values (gen_random_uuid()::text, ${projectId}, now() - interval '2 days', now() - interval '2 days', 1)
  `);
}

async function setup() {
  const products = flag("products")?.split(",").filter(Boolean);
  if (!products?.length) throw new Error("--products <id,id,...> is required");
  if (existsSync(setupPath)) throw new Error(`${setupPath} exists: a setup is frozen once made; use a new tag`);
  mkdirSync(dir, { recursive: true });
  const start = new Date();
  const lookbackDays = Number(flag("lookback") ?? 0);
  // X's recent search reaches back seven days.
  if (!(lookbackDays >= 0 && lookbackDays <= 7)) throw new Error("--lookback is 0 to 7 days");
  const from = new Date(start.getTime() - lookbackDays * 24 * 3600 * 1000);
  const out: ProductSetup[] = [];
  for (const source of products) {
    const project = await loadScanProject(source);
    if (!project) throw new Error(`no project ${source}`);
    const [row] = await rows<{ name: string; url: string | null }>(sql`select name, url from projects where id = ${source}`);
    const ownNames = [row.name, domainLabel(row.url)].filter((name): name is string => Boolean(name));
    const copies = { baseline: await copyProject(source), probe: await copyProject(source) };
    const [state] = await rows<{ seeds: unknown }>(sql`select seeds from x_projects where project_id = ${copies.baseline}`);
    const named = rivalSeeds(project.competitors, ownNames);
    // The cached words when the prompt still matches; otherwise one Muse call, as a scan would make.
    const slots = await seedSlotsFor({
      projectId: copies.baseline,
      stored: state?.seeds ?? null,
      product: project.product,
      phrasings: project.phrasings,
      competitors: named,
    });
    // As runXScan reads them, so the baseline copy keeps exactly the lanes a scan would compile.
    const notProducts = new Set((slots?.notProducts ?? []).map((name) => slug(name)).filter((name) => name.length > 0));
    const seeds = named.filter((name) => !notProducts.has(slug(name)));
    const hash = lanesInputHash(seeds, slots, ownNames);
    const baseline = compileLanes({ rivals: seeds, slots, ownNames });
    const probeTerms = audit.probeTerms({ rivals: seeds, slots, phrasings: project.phrasings });
    const probe = audit.compileProbeLanes(probeTerms);
    await insertLanes(copies.baseline, baseline, (rank) => baseline[rank].seeds, from);
    await insertLanes(copies.probe, probe, () => [], from);
    // Both copies hold the hash of the inputs they were built from, so a scan keeps their lanes as they are.
    for (const id of Object.values(copies)) {
      await db().execute(sql`update x_projects set lanes_input_hash = ${hash}, seeds = (select seeds from x_projects where project_id = ${copies.baseline}) where project_id = ${id}`);
    }
    out.push({
      source,
      name: row.name,
      copies,
      probeTerms,
      lanes: {
        baseline: baseline.map(({ label, family, terms, body }) => ({ label, family, terms, body })),
        probe: probe.map(({ label, family, terms, body }) => ({ label, family, terms, body })),
      },
    });
    console.log(`${row.name}: ${baseline.length} baseline lanes, ${probe.length} probe lanes (${probeTerms.length} terms)`);
  }
  const frozen = { tag, probeVersion: audit.PROBE_VERSION, start: start.toISOString(), from: from.toISOString(), lookbackDays, products: out };
  writeFileSync(setupPath, JSON.stringify({ ...frozen, hash: audit.configHash(frozen) }, null, 2));
  console.log(`frozen at ${setupPath}`);
}

async function run() {
  const setup = readSetup();
  const only = flag("only")?.split(",");
  // A backfill's first pass reads the whole lookback; every pass after reads what is new, as a scan does.
  const pages = flag("pages");
  const backfill = setup.lookbackDays ? { windowHours: setup.lookbackDays * 24 + 1, pagesPerLane: Number(pages ?? 10) } : undefined;
  for (const product of setup.products) {
    if (only && !only.includes(product.name) && !only.includes(product.source)) continue;
    for (const arm of ["baseline", "probe"] as const) {
      const id = product.copies[arm];
      await db().execute(sql`update x_projects set last_opened_at = now() where project_id = ${id}`);
      await markLanesDue(id);
      // The runs this pass adds, by id: the database clock and this one can disagree by seconds.
      const before = await rows<{ id: string }>(sql`select id from x_runs where project_id = ${id}`);
      try {
        await runXScan(id, null, backfill);
      } catch (error) {
        console.error(`${product.name} ${arm}: ${error instanceof Error ? error.message : error}`);
      }
      const [stats] = await rows<Row>(sql`
        select coalesce(sum(pages),0)::int pages, coalesce(sum(posts_new),0)::int new, coalesce(sum(judged),0)::int judged,
               coalesce(sum(profiles),0)::int profiles, coalesce(sum(parents),0)::int parents,
               coalesce(sum(leads),0)::int leads, coalesce(sum(replies),0)::int replies, max(partial_reason) partial
        from x_runs where project_id = ${id}
          ${before.length ? sql`and id not in (${sql.join(before.map((row) => sql`${row.id}`), sql`, `)})` : sql``}`);
      console.log(`${product.name} ${arm}: ${JSON.stringify(stats)}`);
    }
  }
  const log = join(dir, "runs.jsonl");
  writeFileSync(log, `${existsSync(log) ? readFileSync(log, "utf8") : ""}${JSON.stringify({ at: new Date().toISOString() })}\n`);
}

type Seen = {
  tweet_id: string;
  project_id: string;
  stage: string;
  free_reject: string | null;
  reason_code: string | null;
  label: string | null;
  text: string;
  author: string;
  created_at: Date;
  conversation_id: string | null;
  in_reply_to_id: string | null;
};

/** Every post either arm of a product saw since the setup, with each arm's verdict. */
async function seenBy(product: ProductSetup, start: string, until: string | null): Promise<Seen[]> {
  const ids = Object.values(product.copies);
  return rows<Seen>(sql`
    select e.tweet_id, e.project_id, e.stage, e.free_reject, e.reason_code, l.label,
           p.text, p.author_username as author, p.created_at, p.conversation_id, p.in_reply_to_id
    from x_evaluations e
    join x_posts p on p.id = e.tweet_id
    left join x_lanes l on l.id = e.lane_id
    where e.project_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      and p.created_at >= ${start}::timestamptz
      ${until ? sql`and p.created_at < ${until}::timestamptz` : sql``}
  `);
}

/** A seeded shuffle, so a sample drawn twice is the same sample. */
const shuffled = audit.shuffled;

/**
 * The posts to label, blind to arm and verdict: every post either arm
 * showed, a seeded sample of the ones judged out, and a seeded sample of the
 * ones the screen dropped (each sample's weight recorded in weights.json, so
 * the report estimates those losses rather than just listing them). One post
 * per product/post. Conversation deduplication belongs in metrics, not in
 * weights whose population is posts.
 */
async function sample() {
  const setup = readSetup();
  if (["to-label.jsonl", "weights.json", "strata.json", "sampling.json"].some((file) => existsSync(join(dir, file)))) throw new Error("sample already frozen; use a new tag");
  const until = flag("until") ?? null;
  const from = flag("from") ?? setup.from ?? setup.start;
  const screenedPerProduct = Number(flag("screened") ?? 40);
  const judgedPerProduct = Number(flag("judged") ?? 80);
  const out: string[] = [];
  const weights: Record<string, number> = {};
  const strata: Row[] = [];
  for (const product of setup.products) {
    const [facts] = await rows<Row>(sql`select name, url, pain, solution, target_users from projects where id = ${product.source}`);
    const seen = await seenBy(product, from, until);
    const byTweet = new Map<string, Seen[]>();
    for (const row of seen) byTweet.set(row.tweet_id, [...(byTweet.get(row.tweet_id) ?? []), row]);
    const samples = audit.samplePosts([...byTweet.values()].map((group) => ({ id: group[0].tweet_id, stages: group.map((row) => row.stage), row: group[0] })), `${setup.hash}:${product.source}`, judgedPerProduct, screenedPerProduct);
    for (const sample of samples) {
      strata.push({ product: product.name, unit: "product_post", stratum: sample.stratum, population: sample.population, sampled: sample.selected.length, weight: sample.weight, keys: sample.selected.map((post) => `${product.source}:${post.id}`) });
      for (const post of sample.selected) weights[`${product.source}:${post.id}`] = sample.weight!;
    }
    for (const { row } of samples.flatMap((sample) => sample.selected)) {
      const [parent] = row.in_reply_to_id
        ? await rows<{ text: string; author: string }>(sql`select text, author_username as author from x_posts where id = ${row.in_reply_to_id}`)
        : [];
      out.push(
        JSON.stringify({
          key: `${product.source}:${row.tweet_id}`,
          product: { name: facts.name, url: facts.url, pain: facts.pain, solution: facts.solution, targetUsers: facts.target_users },
          post: { text: row.text, author: row.author, url: `https://x.com/${row.author}/status/${row.tweet_id}`, created: row.created_at },
          ...(parent ? { replyingTo: { author: parent.author, text: parent.text } } : {}),
        }),
      );
    }
  }
  const labelled = join(dir, "to-label.jsonl");
  writeFileSync(labelled, `${shuffled(out, setup.hash).join("\n")}\n`);
  writeFileSync(join(dir, "strata.json"), JSON.stringify(strata, null, 2));
  writeFileSync(join(dir, "weights.json"), JSON.stringify(weights));
  writeFileSync(join(dir, "sampling.json"), JSON.stringify({ version: 2, unit: "product_post", setupHash: setup.hash, from, until, judgedPerProduct, screenedPerProduct, strata }, null, 2));
  writeFileSync(join(dir, "LABELLING.md"), `${audit.LABEL_RUBRIC}\n`);
  console.table(strata);
  console.log(`${out.length} posts to label at ${labelled}`);
}

const commands: Record<string, () => Promise<void>> = { setup, run, sample };
const chosen = command ? commands[command] : undefined;
if (!chosen) throw new Error("usage: x-audit <setup|run|sample|snapshot|offline|report> --tag <tag> ...");
await chosen();
process.exit(0);
