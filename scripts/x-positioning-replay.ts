import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Answers } from "../src/lib/jev";
import type { ProductFacts } from "../src/lib/product";
import type { XCandidate } from "../src/lib/x/judge";
import type { XLevel } from "../src/lib/x/gates";
import { briefWarnings, positioningReplay, type ReplayVerdict } from "./lib/x-positioning";

/** Offline only: no .env, scans, DB calls, new model answers or original-label edits. */
globalThis.fetch = async () => { throw new Error("Network is forbidden in the file-only positioning replay"); };
const { assess, candidateState } = await import("../src/lib/x/judge");
const { VENUE_FAMILIES } = await import("../src/lib/x/lanes");
const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!["--fresh", "--archive", "--out"].includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) {
    throw new Error("usage: tsx scripts/x-positioning-replay.ts --fresh <dir> --archive <dir> --out <new-dir>");
  }
  options.set(args[i], args[i + 1]);
}
if (options.size !== 3) throw new Error("--fresh, --archive and --out are required");
const fresh = resolve(options.get("--fresh")!), archive = resolve(options.get("--archive")!), out = resolve(options.get("--out")!);
if (existsSync(out)) throw new Error("Preserve existing output: choose a new --out directory");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const inputs = new Map<string, string>();
const read = (path: string) => {
  if (path === out || path.startsWith(out + "/")) throw new Error("Output must not contain input files");
  const contents = readFileSync(path, "utf8"); inputs.set(path, sha(contents)); return contents;
};
const json = <T>(path: string): T => JSON.parse(read(path));
const jsonl = <T>(path: string): T[] => read(path).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
type Label = { key: string; gold: string };
const labels = (paths: string[]) => new Map(paths.flatMap((path) => jsonl<Label>(path)).map((row) => [row.key, row.gold]));
const freshLabels = labels([join(fresh, "labels.jsonl")]);
const oldLabels = labels([join(archive, "labels.jsonl"), join(archive, "offline/model-adjudications.jsonl"), join(archive, "validation/unseen-labels.jsonl")]);
type LegacyFacts = {
  name: string; url: string | null; pain: string | null; solution: string | null; target_users: string | null;
  geography: string | null; budget_fit: string | null; capabilities: string[]; exclusions: string[];
  not_buyers: string[]; brief?: ProductFacts["brief"];
};
const factsOf = (facts: LegacyFacts, rivals: string[]): ProductFacts => ({
  name: facts.name, url: facts.url, pain: facts.pain ?? "", solution: facts.solution ?? "", targetUsers: facts.target_users ?? "",
  serviceGeography: facts.geography ?? "", budgetFit: facts.budget_fit ?? "", capabilities: facts.capabilities,
  exclusions: facts.exclusions, notBuyers: facts.not_buyers, competitors: rivals, brief: facts.brief,
});
type Context = { text?: string; bio?: string; replyingTo?: string[]; chainIncomplete?: boolean };
type Post = { id: string; text: string; author_username: string; created_at: string; reply_count: number | null; like_count?: number | null; view_count?: number | null; fetched_at?: string };
type Evaluation = { project_id: string; tweet_id: string; stage: string; free_reject?: string | null; level: string | null; signals: Answers | null; context: Context | null; family?: string };
type FreshProduct = { name: string; source: string; copies: Record<string, string>; facts: ProductFacts; evaluations: Evaluation[]; posts: Post[]; authors: Array<{ username: string; bio: string | null }>; leads: Array<{ project_id: string; tweet_id: string; kind: string }> };
const manifest = json<{ from: string; until: string; hash: string }>(join(fresh, "manifest.json"));
const snapshot = json<{ manifestHash: string; hash: string; products: FreshProduct[] }>(join(fresh, "snapshot.json"));
if (snapshot.manifestHash !== manifest.hash) throw new Error("Fresh manifest/snapshot mismatch");
type Case = { dataset: string; arm: string; key: string; product: string; facts: ProductFacts; candidate: XCandidate; level: XLevel; answers: Answers; storedStage: string; gold: string; now: string; replies: boolean };
const cases: Case[] = [];
const skipped: Record<string, number> = {};
const missingFreshPosts: Array<{ product: string; arm: string; tweet: string }> = [];
const skip = (key: string) => { skipped[key] = (skipped[key] ?? 0) + 1; };
const versions = new Map<string, { facts: ProductFacts; datasets: Set<string> }>();
const addFacts = (facts: ProductFacts, dataset: string) => {
  const key = sha(JSON.stringify(facts)); const found = versions.get(key);
  if (found) found.datasets.add(dataset); else versions.set(key, { facts, datasets: new Set([dataset]) });
};
for (const product of snapshot.products) {
  addFacts(product.facts, "fresh");
  const posts = new Map(product.posts.map((post) => [post.id, post]));
  const bios = new Map(product.authors.map((author) => [author.username.toLowerCase(), author.bio]));
  for (const row of product.evaluations) {
    const arm = Object.entries(product.copies).find(([, id]) => id === row.project_id)?.[0];
    if (!arm || arm === "reference") throw new Error("Unknown comparison copy");
    if (row.stage === "free_rejected" || row.free_reject || !row.signals || !["search", "complete"].includes(row.level ?? "")) { skip("fresh:screened_or_unanswered"); continue; }
    const post = posts.get(row.tweet_id);
    // The frozen exporter includes only posts inside its window, but exports
    // every evaluation, including older ancestors. Do not invent their text.
    if (!post) { skip("fresh:post_absent_from_window_export"); missingFreshPosts.push({ product: product.name, arm, tweet: row.tweet_id }); continue; }
    const createdAt = new Date(post.created_at);
    if (createdAt < new Date(manifest.from) || createdAt > new Date(manifest.until)) { skip("fresh:outside_window"); continue; }
    const candidate: XCandidate = {
      tweetId: post.id, text: row.context?.text ?? post.text, rawText: post.text, authorUsername: post.author_username,
      replyingTo: row.context?.replyingTo ?? [], chainIncomplete: row.context?.chainIncomplete ?? false,
      bio: row.context?.bio ?? bios.get(post.author_username.toLowerCase()) ?? null, createdAt, replyCount: post.reply_count,
      likeCount: post.like_count, viewCount: post.view_count, fetchedAt: post.fetched_at ? new Date(post.fetched_at) : null,
      venue: VENUE_FAMILIES.has(row.family ?? ""),
    };
    const key = `${product.source}:${post.id}`;
    cases.push({ dataset: "fresh", arm, key, product: product.name, facts: product.facts, candidate,
      level: row.level as XLevel, answers: row.signals, storedStage: row.stage, gold: freshLabels.get(key) ?? "unlabelled", now: manifest.until, replies: true });
  }
}
type OldProduct = { name: string; source: string; copies: Record<string, string>; facts: LegacyFacts; rows: Evaluation[] };
type OldPost = { key: string; tweet: string; text: string; author: string; created: string; arms: Record<string, { lane?: { family?: string } } | undefined> };
const old = json<{ products: OldProduct[] }>(join(archive, "candidate/inputs.json"));
const oldSnapshot = json<{ posts: OldPost[] }>(join(archive, "snapshot.json"));
const oldSetup = json<{ start: string; products: Array<{ source: string; lanes: { baseline: Array<{ seeds?: string[] }> } }> }>(join(archive, "setup.json"));
const oldPosts = new Map(oldSnapshot.posts.map((post) => [post.key, post]));
for (const product of old.products) {
  const setup = oldSetup.products.find((row) => row.source === product.source); if (!setup) throw new Error("Old setup mismatch");
  const facts = factsOf(product.facts, [...new Set(setup.lanes.baseline.flatMap((lane) => lane.seeds ?? []))]);
  addFacts(facts, "archive-full");
  for (const row of product.rows) {
    const arm = Object.entries(product.copies).find(([, id]) => id === row.project_id)?.[0]; if (!arm) throw new Error("Unknown old comparison copy");
    if (row.stage === "free_rejected" || row.free_reject || !row.signals || !["search", "complete"].includes(row.level ?? "")) { skip("archive-full:screened_or_unanswered"); continue; }
    const key = `${product.source}:${row.tweet_id}`;
    const post = oldPosts.get(key); if (!post) throw new Error(`Missing old frozen post ${key}`);
    cases.push({ dataset: "archive-full", arm, key, product: product.name, facts, level: row.level as XLevel,
      answers: row.signals, storedStage: row.stage, gold: oldLabels.get(key) ?? "unlabelled", now: oldSetup.start, replies: true,
      candidate: { tweetId: post.tweet, text: row.context?.text ?? post.text, rawText: post.text, authorUsername: post.author,
        replyingTo: row.context?.replyingTo ?? [], chainIncomplete: row.context?.chainIncomplete ?? false,
        bio: row.context?.bio ?? null, createdAt: new Date(post.created), replyCount: null,
        venue: VENUE_FAMILIES.has(post.arms[arm]?.lane?.family ?? "") } });
  }
}
type ValidationCase = { key: string; product: string; facts: LegacyFacts; rivals: string[]; text: string; rawText: string; author: string; bio: string | null; replyingTo: string[]; chainIncomplete: boolean; created: string };
const validation = json<{ manifest: ValidationCase[] }>(join(archive, "validation/manifest.json"));
const validationCases = new Map(validation.manifest.map((row) => [row.key, row]));
type ValidationOutput = { key: string; level: XLevel; arms: { candidate: { answers: Answers; assessment: ReplayVerdict } } };
for (const output of jsonl<ValidationOutput>(join(archive, "validation/candidate-final-outputs.jsonl"))) {
  const row = validationCases.get(output.key); if (!row) throw new Error("Validation manifest mismatch");
  const facts = factsOf(row.facts, row.rivals); addFacts(facts, "archive-88-final");
  cases.push({ dataset: "archive-88-final", arm: "candidate", key: row.key, product: row.product, facts, level: output.level,
    answers: output.arms.candidate.answers, storedStage: output.arms.candidate.assessment.stage,
    gold: oldLabels.get(row.key) ?? "unlabelled", now: oldSetup.start, replies: false,
    candidate: { tweetId: row.key.split(":").at(-1)!, text: row.text, rawText: row.rawText, authorUsername: row.author,
      bio: row.bio, replyingTo: row.replyingTo, chainIncomplete: row.chainIncomplete, createdAt: new Date(row.created), replyCount: null } });
}

const verdict = ({ decision, stage, code }: ReplayVerdict): ReplayVerdict => ({ decision, stage, code });
const rows = cases.map((row) => {
  const sentences = candidateState(row.facts, row.candidate, row.level).sentences;
  const before = verdict(assess(row.answers, row.candidate, sentences, row.level, new Date(row.now), row.replies));
  const wanted = row.answers.wanted_kind;
  const neighbour = wanted?.type === "choice" && /^n\d+$/u.test(wanted.choice) ? wanted.choice : null;
  let withoutNeighbour: ReplayVerdict | null = null;
  if (neighbour) {
    // Diagnostic copy only: raw saved answers are never changed or overwritten.
    const ablation = { ...row.answers }; delete ablation.wanted_kind;
    withoutNeighbour = verdict(assess(ablation, row.candidate, sentences, row.level, new Date(row.now), row.replies));
  }
  const proposed = positioningReplay(row.answers, row.level, before, withoutNeighbour);
  if (proposed.stage === "lead" && before.stage !== "lead") throw new Error("A positioning conflict must never qualify a new buyer");
  return { dataset: row.dataset, arm: row.arm, key: row.key, product: row.product, developmentOnly: row.product === "AnyAPI",
    gold: row.gold, level: row.level, storedStage: row.storedStage, before, proposed, withoutNeighbour,
    changed: JSON.stringify(before) !== JSON.stringify(proposed), neighbour,
    selectedNeighbour: neighbour ? row.facts.brief?.neighbours[Number(neighbour.slice(1))] ?? null : null,
    briefWarning: neighbour ? briefWarnings(row.facts).filter((warning) => warning.neighbour === neighbour) : [],
    hasSavedReplyingToText: row.candidate.replyingTo.length > 0, chainIncomplete: row.candidate.chainIncomplete,
    needQuote: assess(row.answers, row.candidate, sentences, row.level, new Date(row.now), row.replies).needQuote };
});
const warnings = [...versions.entries()].map(([hash, { facts, datasets }]) => ({ hash, product: facts.name, developmentOnly: facts.name === "AnyAPI",
  datasets: [...datasets], hasBrief: Boolean(facts.brief), warnings: briefWarnings(facts) }));
const countStages = (items: typeof rows, scenario: "before" | "proposed") => {
  const counts: Record<string, number> = {}; for (const row of items) counts[row[scenario].stage] = (counts[row[scenario].stage] ?? 0) + 1; return counts;
};
const groups = [...new Set(rows.map((row) => `${row.dataset}/${row.arm}`))].map((group) => {
  const items = rows.filter((row) => `${row.dataset}/${row.arm}` === group);
  return { group, cases: items.length, developmentOnly: items.filter((row) => row.developmentOnly).length,
    before: countStages(items, "before"), proposed: countStages(items, "proposed"), changes: items.filter((row) => row.changed).length,
    neighbourSelections: items.filter((row) => row.neighbour).length,
    diagnosticBuyerFlips: items.filter((row) => row.before.stage !== "lead" && row.withoutNeighbour?.stage === "lead").length };
});
// Hash original evidence and replay code; refuse to report success if inputs changed.
for (const path of ["scripts/x-positioning-replay.ts", "scripts/lib/x-positioning.ts", "src/lib/x/judge.ts", "src/lib/x/gates.ts", "src/lib/x/lanes.ts", "src/lib/product.ts", "src/lib/scan/spans.ts"]) read(resolve(path));
for (const [path, hash] of inputs) if (sha(readFileSync(path, "utf8")) !== hash) throw new Error(`Input changed during replay: ${path}`);
const output = { version: 1, policy: "Offline hypothesis only; conflicts stay Maybe/pending-context and do not qualify buyers", rawInputSha256: Object.fromEntries(inputs), missingFreshPosts,
  freshManifestHash: manifest.hash, freshSnapshotHash: snapshot.hash, skipped, warnings, groups, rows };
const lines = ["# Offline positioning check and saved-answer replay", "", "No paid calls, .env loading, DB access, production changes, new answers or relabelling. Existing output directories are refused. Raw inputs were SHA-256 checked before and after.", "",
  "**This is development evidence, not a new validation result.** All arms use the current candidate assessor with their own archived answers. Historical stored stages are kept separately; reply checks, free screens and retrieval are not rerun. Dataset rows overlap and must not be pooled as independent observations. AnyAPI is development-only.", "",
  "## Hypothesis", "", "When a neighbour veto is the only remaining buyer blocker, call it positioning_conflict and keep it Maybe (or pending_context at search level), not wrong_job. Mandatory requirements, quote, seller, audience, own-need and context checks still apply. This helper is NOT connected to production. The without-neighbour diagnostic omits just that answer in a copy; any resulting buyers are counterfactuals, not recovered leads.", "",
  "## Lexical brief review flags", "", "A neighbour naming a competitor or sharing at least two non-generic words with a capability needs review. Capability words use shallow plural/ing/er normalization; competitor names keep exact token boundaries. These are lexical overlaps, not proven contradictions: a competitor can legitimately serve an adjacent segment, and a capability mention may be negated. The check does not infer missing features or cover all semantic conflicts.", "",
  "| Product | Saved fact version | Datasets | Neighbours flagged |", "|---|---|---|---|"];
for (const row of warnings) lines.push(`| ${row.product}${row.developmentOnly ? " (dev)" : ""} | ${row.hash.slice(0, 12)} | ${row.datasets.join(", ")} | ${row.warnings.map((warning) => `${warning.neighbour}: ${warning.kind}`).join("; ") || (row.hasBrief ? "none" : "brief missing")} |`);
lines.push("", "## Gate replay (before the separate reply check)", "", "These are assess() stages, not final UI feeds. pending_reply still needs the separate reply check; we do not predict its result. Historical rows use the current assessor, not historical baseline rules. Archive competitor names come from saved baseline lane seeds, not a new complete competitor export.", "",
  "| Dataset/arm | Answered cases | Current lead / review | Proposed lead / review | Reason/routing changes | Diagnostic buyer flips without neighbour |", "|---|---:|---:|---:|---:|---:|");
for (const group of groups) lines.push(`| ${group.group} | ${group.cases} | ${group.before.lead ?? 0} / ${group.before.review ?? 0} | ${group.proposed.lead ?? 0} / ${group.proposed.review ?? 0} | ${group.changes} | ${group.diagnosticBuyerFlips} |`);
lines.push("", "## Every hypothetical reason/routing change", "");
for (const row of rows.filter((row) => row.changed)) lines.push(`- ${row.dataset}/${row.arm}, ${row.product}${row.developmentOnly ? " (dev)" : ""}, ${row.key}: ${row.before.stage}/${row.before.code} → ${row.proposed.stage}/${row.proposed.code}; model label ${row.gold}. Selected ${row.neighbour}: ${row.selectedNeighbour?.kind ?? "not saved"}. Without-neighbour diagnostic: ${row.withoutNeighbour?.stage}/${row.withoutNeighbour?.code}.`);
lines.push("", "## Observed fresh UI categories (not replay predictions)", "", "Held/review cards appear in the X tab's Maybe group. The original report's displayed-card count counted leads/replies only, not Maybe. Keep these categories distinct; the proposed policy does not recover a buyer automatically.", "");
for (const arm of ["baseline", "candidate"]) {
  const held = snapshot.products.flatMap((product) => product.evaluations.filter((row) => row.project_id === product.copies[arm] && row.stage === "review" && product.posts.some((post) => post.id === row.tweet_id)).map((row) => ({ product: product.name, key: `${product.source}:${row.tweet_id}`, gold: freshLabels.get(`${product.source}:${row.tweet_id}`) ?? "unlabelled" })));
  lines.push(`- ${arm}: ${held.length} saved Maybe cards inside the frozen window. ${held.map((row) => `${row.product} ${row.key} (${row.gold})`).join("; ") || "None"}.`);
}
lines.push("", "Two answered ancestor evaluations lack window-exported text and are listed in results.json; screened/unanswered rows are counted separately, not replayed. The second Maybe card was not selected for the original blind sample and remains unlabelled.");
lines.push("", "## Limits and next step", "", "Labels remain the original disputed model judgements, not human ground truth. No unknown platform/feature requirement is turned into a supported fit. No parent is fetched and no search coverage is repaired. A separate owner positioning decision is still needed for general Clipy recording requests. Keep the runtime PR draft. Review the brief flags and all changed outcomes before choosing a runtime fix; then validate frozen changes in a different window.", "");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "results.json"), JSON.stringify(output, null, 2) + "\n");
writeFileSync(join(out, "REPORT.md"), lines.join("\n") + "\n");
console.log(JSON.stringify({ out, cases: rows.length, factVersions: warnings.length, flaggedVersions: warnings.filter((row) => row.warnings.length).length,
  changed: rows.filter((row) => row.changed).length, groups, skipped }, null, 2));
