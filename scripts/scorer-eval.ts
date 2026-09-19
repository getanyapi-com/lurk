/**
 * Runs the judge over a labelled set and prints how its verdicts compare with
 * the labels, so a change to the questions or the profile prompt is measured
 * before it ships. The set is posts a person (or a stronger model) has already
 * called `lead`, `weak` or `not` for a product; it holds customers' data, so it
 * lives under .context and never in the repo.
 *
 *   npm run scorer:eval -- --set .context/audit/labelled.json --out .context/audit/run.json
 *   npm run scorer:eval -- --set ... --facts .context/audit/facts.json   (profiles to judge against instead)
 *
 * Every call is a real Jev call billed to the house key: about $0.10 for 1,500 posts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const { db } = await import("../src/db");
const { projects } = await import("../src/db/schema");
const { judgeItems } = await import("../src/lib/scan/score");
const { routeLead } = await import("../src/lib/scan/gates");
type ProductFacts = import("../src/lib/product").ProductFacts;

type Gold = "lead" | "weak" | "not";
type LabelledItem = { id: string; title: string; subreddit: string; body: string; gold: Gold; was: string };
type LabelledProject = { id: string; name: string; facts: ProductFacts; items: LabelledItem[] };

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const setPath = flag("set");
if (!setPath) throw new Error("--set is required");
const set = JSON.parse(readFileSync(setPath, "utf8")) as LabelledProject[];
const factsPath = flag("facts");
const override: Record<string, ProductFacts> = factsPath ? JSON.parse(readFileSync(factsPath, "utf8")) : {};
const only = flag("only")?.split(",");

/** llm_usage rows need a project that exists here; the labelled ones are another database's. */
const [local] = await db().select({ id: projects.id }).from(projects).limit(1);
if (!local) throw new Error("the local database has no project to bill the calls to");

type Row = { project: string; id: string; gold: Gold; was: string; shown: "buyer" | "context" | null; code: string; fit: number | null; intent: number | null; score: number };

async function run(project: LabelledProject): Promise<Row[]> {
  const items = project.items.map((item) => ({
    id: item.id,
    title: item.title,
    subreddit: item.subreddit,
    body: item.body,
    author: null,
    ageHours: 24,
    upvotes: null,
    numComments: 5,
    parentBody: null,
  }));
  const judged = await judgeItems(local.id, override[project.id] ?? project.facts, items);
  const byId = new Map(judged.map((item) => [item.id, item]));
  return project.items.flatMap((item) => {
    const verdict = byId.get(item.id);
    if (!verdict) return [];
    return [{ project: project.name, id: item.id, gold: item.gold, was: item.was, shown: routeLead(verdict), code: verdict.reasonCode, fit: verdict.fit, intent: verdict.intent, score: verdict.score }];
  });
}

const chosen = set.filter((project) => !only || only.includes(project.id) || only.includes(project.name));
const rows: Row[] = [];
const queue = [...chosen];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let project = queue.shift(); project; project = queue.shift()) {
      try {
        rows.push(...(await run(project)));
      } catch (error) {
        console.error(`${project.name}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }),
);

function tally(kind: "buyer" | "context") {
  const shown = rows.filter((row) => row.shown === kind);
  const count = (gold: Gold) => shown.filter((row) => row.gold === gold).length;
  const pct = (n: number) => (shown.length === 0 ? "-" : `${Math.round((100 * n) / shown.length)}%`);
  console.log(`${kind.padEnd(8)} shown ${String(shown.length).padEnd(5)} lead ${pct(count("lead")).padEnd(5)} weak ${pct(count("weak")).padEnd(5)} not ${pct(count("not"))}`);
}

const leads = rows.filter((row) => row.gold === "lead");
console.log(`judged ${rows.length} of ${chosen.reduce((n, project) => n + project.items.length, 0)} across ${chosen.length} projects`);
tally("buyer");
tally("context");
console.log(`recall   ${leads.filter((row) => row.shown === "buyer").length} of ${leads.length} labelled leads shown as buyer, ${leads.filter((row) => row.shown === "context").length} as context`);
const codes = new Map<string, number>();
for (const row of leads.filter((row) => row.shown !== "buyer")) codes.set(row.code, (codes.get(row.code) ?? 0) + 1);
console.log(`lost leads by code: ${[...codes].map(([code, n]) => `${code} ${n}`).join(", ") || "none"}`);

const out = flag("out");
if (out) writeFileSync(out, JSON.stringify(rows));
process.exit(0);
