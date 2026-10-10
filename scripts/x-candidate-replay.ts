import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Answers } from "../src/lib/jev";
import type { ProductFacts } from "../src/lib/product";
import { configHash, textMatches } from "../src/lib/x/audit";
import { conversationKey, parseJsonl, type AuditLabel, type SnapshotPost } from "../src/lib/x/audit-eval";
import { assess, candidateState, type XCandidate } from "../src/lib/x/judge";
import { compileRequestLane, type SeedSlots, VENUE_FAMILIES } from "../src/lib/x/lanes";
import { X_LANES_VERSION, X_SCORER_VERSION } from "../src/lib/x/constants";
import { toXPost } from "../src/lib/x/map";
import { matchedLaneTerms } from "../src/lib/x/screen";

/** File-only ablation, not a scan or a prediction of unobserved judge answers. */
const dir = process.argv[2];
if (!dir || process.argv.length !== 3) throw new Error("usage: tsx scripts/x-candidate-replay.ts <saved-audit-dir>");
const read = (path: string) => readFileSync(join(dir, path), "utf8");
type Row = {
  tweet_id: string; project_id: string; signals: Answers | null; level: string | null; stage: string;
  context: { text?: string; replyingTo?: string[]; chainIncomplete?: boolean; bio?: string } | null;
};
type Input = {
  products: Array<{
    name: string; source: string; copies: { baseline: string; probe: string };
    facts: { name: string; url: string | null; pain: string | null; solution: string | null; target_users: string | null;
      geography: string | null; budget_fit: string | null; capabilities: string[]; exclusions: string[]; not_buyers: string[] };
    seeds: { slots: SeedSlots } | null; rows: Row[];
  }>;
};
const inputs: Input = JSON.parse(read("candidate/inputs.json"));
const setup = JSON.parse(read("setup.json"));
const snapshot: { posts: SnapshotPost[] } = JSON.parse(read("snapshot.json"));
const posts = new Map(snapshot.posts.map((post) => [post.key, post]));
const labels = new Map(parseJsonl<AuditLabel>(read("labels.jsonl")).map((row) => [row.key, row.gold]));
for (const row of parseJsonl<AuditLabel>(read("offline/model-adjudications.jsonl"))) labels.set(row.key, row.gold);
const counts = (keys: string[]) => {
  const categories = { ask: 0, reply: 0, not: 0, insufficient: 0, unlabelled: 0 };
  const unique = new Set<string>();
  for (const key of keys) {
    const gold = labels.get(key) ?? "unlabelled";
    categories[gold] += 1;
    if (gold === "ask") unique.add(conversationKey(posts.get(key)!));
  }
  return { total: keys.length, ...categories, uniqueBuyers: unique.size };
};
const results = inputs.products.map((product) => {
  const saved = setup.products.find((p: { source: string }) => p.source === product.source);
  if (!saved) throw new Error("setup mismatch");
  const rivals = [...new Set<string>(saved.lanes.baseline.flatMap((lane: { seeds?: string[] }) => lane.seeds ?? []))];
  const lane = compileRequestLane(product.seeds?.slots ?? null, rivals, [product.name]);
  const cohort = snapshot.posts.filter((post) => post.product === product.name && labels.has(post.key));
  const oldReach = cohort.filter((post) => saved.lanes.baseline.some((l: { terms: string[][] }) => textMatches(post.text, l.terms)));
  const newReach = cohort.filter((post) => oldReach.includes(post) || (lane && textMatches(post.text, lane.terms)));
  const addedTermPass = cohort.filter((post) => {
    if (!lane || oldReach.includes(post)) return false;
    const input = toXPost({ id: post.tweet, text: post.text, authorUsername: post.author,
      createdUtc: new Date(post.created).getTime() / 1000, isReply: post.isReply });
    if (!input) throw new Error(`invalid post ${post.key}`);
    return matchedLaneTerms(input, lane.terms, false) !== null;
  });
  const facts: ProductFacts = {
    name: product.name, url: product.facts.url, pain: product.facts.pain ?? "", solution: product.facts.solution ?? "",
    targetUsers: product.facts.target_users ?? "", serviceGeography: product.facts.geography ?? "",
    budgetFit: product.facts.budget_fit ?? "", capabilities: product.facts.capabilities,
    exclusions: product.facts.exclusions, notBuyers: product.facts.not_buyers, competitors: rivals,
  };
  const arms = ["baseline", "probe"] as const;
  const gateResults = arms.map((arm) => {
    const before: string[] = [], after: string[] = [], changes: Array<{ key: string; gold: string; before: string; after: string; code: string }> = [];
    let unanswered = 0;
    const recoveredRequests: Array<{ key: string; gold: string; stage: string }> = [];
    for (const row of product.rows.filter((r) => r.project_id === product.copies[arm])) {
      const key = `${product.source}:${row.tweet_id}`;
      const post = posts.get(key);
      if (!post) throw new Error(`missing frozen post: ${key}`);
      if (row.stage === "lead") before.push(key);
      if (!row.signals || !["search", "complete"].includes(row.level ?? "")) { unanswered++; continue; }
      const candidate: XCandidate = {
        tweetId: post.tweet, text: row.context?.text ?? post.text, rawText: post.text,
        authorUsername: post.author, replyingTo: row.context?.replyingTo ?? [],
        chainIncomplete: row.context?.chainIncomplete ?? false, bio: row.context?.bio ?? null,
        createdAt: new Date(post.created), replyCount: null,
        venue: VENUE_FAMILIES.has(post.arms[arm]?.lane?.family ?? ""),
      };
      const level = row.level === "complete" ? "complete" : "search";
      const sentences = candidateState(facts, candidate, level).sentences;
      const verdict = assess(row.signals, candidate, sentences, level, new Date(setup.start));
      if (verdict.stage === "lead") after.push(key);
      if (row.signals.own_need?.type === "noul" && row.signals.own_need.noul < 0.5 && verdict.decision === "qualify") {
        recoveredRequests.push({ key, gold: labels.get(key) ?? "unlabelled", stage: verdict.stage });
      }
      if ((row.stage === "lead") !== (verdict.stage === "lead")) {
        changes.push({ key, gold: labels.get(key) ?? "unlabelled", before: row.stage, after: verdict.stage, code: verdict.code });
      }
    }
    return { arm, before: counts(before), after: counts(after), unanswered, recoveredRequests, changes };
  });
  return { product: product.name, developmentOnly: product.name === "AnyAPI", requestLane: lane,
    lexical: { before: counts(oldReach.map((p) => p.key)), after: counts(newReach.map((p) => p.key)),
      addedRequestTermPass: counts(addedTermPass.map((p) => p.key)) }, gates: gateResults };
});
const output = { scorerVersion: X_SCORER_VERSION, lanesVersion: X_LANES_VERSION, inputHash: configHash(inputs), results };
writeFileSync(join(dir, "candidate/results.json"), JSON.stringify(output, null, 2));
const lines = ["# Pipeline candidate: saved-answer replay", "", `Scorer: ${X_SCORER_VERSION}; lanes: ${X_LANES_VERSION}; frozen input hash: ${output.inputHash}.`, "",
  "This is an in-sample diagnostic, not an out-of-sample win or global recall. Labels mix the original model with 66 attributed model adjudications. AnyAPI is development-only.", "",
  "The gate ablation executes the real assess() on saved answers and context. The revised own-need prompt has NOT been re-asked. Search-level posts are NOT upgraded to complete. Pending reply checks are NOT assumed to pass. Existing conversation cards are not re-evaluated.", "",
  "The retrieval comparison is lexical matching inside the retrieved, labelled corpus, BEFORE same-sentence/free screens, pagination, dedup and judging. Nonmatches are not global misses. Unknown/unlabelled rows are not confirmed noise.", "",
  "## Stored buyer cards after evidence/intent gates", "",
  "| Product | Arm | Old cards (ask / conversation / not / unknown) | New cards (ask / conversation / not / unknown) | Unique buyers old → new |",
  "|---|---|---|---|---|" ];
const fmt = (c: ReturnType<typeof counts>) => `${c.total} (${c.ask} / ${c.reply} / ${c.not} / ${c.insufficient + c.unlabelled})`;
for (const r of results) for (const g of r.gates) lines.push(`| ${r.product}${r.developmentOnly ? " (dev)" : ""} | ${g.arm} | ${fmt(g.before)} | ${fmt(g.after)} | ${g.before.uniqueBuyers} → ${g.after.uniqueBuyers} |`);
lines.push("", "## Lexical reach of old lanes + one category/request lane", "", "| Product | Old selected (ask / conversation / not / unknown) | New selected (ask / conversation / not / unknown) | Added request posts passing the unchanged visible-term screen |", "|---|---|---|---|");
for (const r of results) lines.push(`| ${r.product}${r.developmentOnly ? " (dev)" : ""} | ${fmt(r.lexical.before)} | ${fmt(r.lexical.after)} | ${fmt(r.lexical.addedRequestTermPass)} |`);
lines.push("", "## Corroborated direct requests recovered from the own-need rejection", "");
for (const r of results) for (const g of r.gates) for (const recovered of g.recoveredRequests) {
  lines.push(`- ${r.product}, ${g.arm}: ${recovered.key}, model label ${recovered.gold}, new stage ${recovered.stage}. This is not a displayed buyer until all context checks finish.`);
}
writeFileSync(join(dir, "candidate/REPORT.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
