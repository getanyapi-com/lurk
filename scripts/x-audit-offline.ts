import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configHash, LABEL_RUBRIC, lossKey, lossOf } from "../src/lib/x/audit";
import {
  armMetrics, buyerGateFailures, keyed, lexicalComparison, parseJsonl, reviewPacket,
  termScreenComparison, validateAdjudication, validateLabel,
  stratifiedTotals, type SampleStratum,
  type Adjudication, type AuditArm, type AuditLabel, type BlindPost, type SnapshotPost,
} from "../src/lib/x/audit-eval";
import { reviewHtml } from "./x-audit-review";

type Setup = { hash: string; tag: string; from?: string; start: string; products: {
  source: string; name: string; lanes: Record<AuditArm, { label: string; terms: string[][] }[]>;
}[] };
type Snapshot = { version: number; setupHash: string; from?: string; until?: string | null; exportedAt: string; contentHash: string; provenance: string; posts: SnapshotPost[] };

function flag(args: string[], name: string) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}
const pct = (n: number, d: number) => d ? `${Math.round(100 * n / d)}%` : "—";
const tally = (rows: AuditLabel[]) => Object.fromEntries(["ask", "reply", "not", "insufficient"].map((gold) => [gold, rows.filter((row) => row.gold === gold).length]));

/** File-only command: no .env, credentials, DB imports, or model calls. */
export async function runOffline(args: string[]) {
  const allowed = new Set(["--tag", "--exclude", "--adjudications"]);
  const options = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || options.has(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`unknown, duplicate or incomplete option: ${args[index]}`);
    options.add(args[index]);
  }
  const tag = flag(args, "tag");
  if (!tag || !/^[\w-]+$/u.test(tag)) throw new Error("--tag is required");
  const dir = join(".context", "x-audit", tag);
  const setup = JSON.parse(readFileSync(join(dir, "setup.json"), "utf8")) as Setup;
  const blind = parseJsonl<BlindPost>(readFileSync(join(dir, "to-label.jsonl"), "utf8"));
  const blindMap = keyed(blind, "blind posts");
  const original = keyed(parseJsonl<AuditLabel>(readFileSync(join(dir, "labels.jsonl"), "utf8")), "model labels");
  for (const label of original.values()) {
    validateLabel(label);
    if (!blindMap.has(label.key)) throw new Error(`${label.key}: label has no blind post`);
  }
  const labels = new Map(original);
  const reviewPath = flag(args, "adjudications");
  const reviewed = reviewPath ? keyed(parseJsonl<Adjudication>(readFileSync(reviewPath, "utf8")), "adjudications") : new Map<string, Adjudication>();
  for (const row of reviewed.values()) {
    validateAdjudication(row);
    if (!blindMap.has(row.key)) throw new Error(`${row.key}: review has no blind post`);
    labels.set(row.key, row);
  }
  const weights = existsSync(join(dir, "weights.json")) ? JSON.parse(readFileSync(join(dir, "weights.json"), "utf8")) as Record<string, number> : {};
  for (const [key, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight < 1) throw new Error(`${key}: invalid sampling weight`);
  }
  const snapshot = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")) as Snapshot;
  const { contentHash, ...snapshotContent } = snapshot;
  if (snapshot.version !== 1 || snapshot.setupHash !== setup.hash || configHash(snapshotContent) !== contentHash) throw new Error("snapshot version/setup/hash mismatch");
  const fates = keyed(snapshot.posts, "snapshot");
  const missing = blind.filter((post) => !fates.has(post.key)).map((post) => post.key);
  if (missing.length) throw new Error(`${missing.length} blind posts missing from snapshot; do not silently exclude them`);
  for (const post of blind) {
    if (fates.get(post.key)!.text !== post.post.text) throw new Error(`${post.key}: snapshot text drifted from blind corpus`);
  }
  const excluded = (flag(args, "exclude") ?? "AnyAPI").split(",").filter(Boolean);
  if (excluded.some((name) => !setup.products.some((product) => product.name === name))) throw new Error("unknown excluded product");
  const out = join(dir, reviewPath ? `offline-reviewed-${configHash([...reviewed.values()])}` : "offline");
  mkdirSync(out, { recursive: true });
  const highWeight = [...original.values()].filter((label) => ["ask", "reply"].includes(label.gold) && (weights[label.key] ?? 1) > 1);
  const influence = highWeight.map((label) => ({ key: label.key, product: blindMap.get(label.key)!.product.name, gold: label.gold, weight: weights[label.key], modelNote: label.note }));
  const samplingPath = join(dir, "sampling.json");
  const sampling = existsSync(samplingPath) ? JSON.parse(readFileSync(samplingPath, "utf8")) as { version: number; unit: string; setupHash: string; from: string; until: string | null; strata: SampleStratum[] } : null;
  if (sampling && (sampling.version !== 2 || sampling.unit !== "product_post" || sampling.setupHash !== setup.hash)) throw new Error("sampling version/unit/setup mismatch");
  if (sampling && (sampling.from !== (snapshot.from ?? setup.from ?? setup.start) || sampling.until !== (snapshot.until ?? null))) throw new Error("sampling/snapshot window mismatch");
  // Validate every product's strata, even when it is excluded from verdicts.
  if (sampling) stratifiedTotals(sampling.strata, labels);
  const estimates = sampling ? stratifiedTotals(sampling.strata.filter((stratum) => !excluded.includes(stratum.product)), labels) : null;
  if (sampling) for (const stratum of sampling.strata) for (const key of stratum.keys) {
    if (!blindMap.has(key) || weights[key] !== stratum.weight) throw new Error("sampling keys/weights mismatch");
  }
  const products = setup.products.map((product) => {
    const all = snapshot.posts.filter((post) => post.product === product.name);
    const sampled = all.filter((post) => labels.has(post.key));
    const selectedLabels = sampled.map((post) => labels.get(post.key)!);
    const laneSets = {
      baseline: product.lanes.baseline,
      broadTerm: product.lanes.probe.filter((lane) => lane.terms.length === 1),
      termPlusRequest: product.lanes.probe.filter((lane) => lane.terms.length > 1),
    };
    const screenChanges: { arm: AuditArm; key: string; gold: string; alternative: string; outcome: string }[] = [];
    const failures: { arm: AuditArm; key: string; gold: string; stage: string; recordedReason: string | null; failures: string[] }[] = [];
    const losses: { arm: AuditArm; key: string; gold: string; loss: string }[] = [];
    for (const post of sampled) {
      const gold = labels.get(post.key)!.gold;
      for (const arm of ["baseline", "probe"] as const) {
        const fate = post.arms[arm];
        const loss = lossOf(fate ? { fetched: true, stage: fate.stage, freeReject: fate.freeReject, reasonCode: fate.reasonCode, laneLabel: fate.lane?.label ?? null } : { fetched: false }, post.text, product.lanes[arm]);
        losses.push({ arm, key: post.key, gold, loss: lossKey(loss) });
        if (fate?.signals) failures.push({ arm, key: post.key, gold, stage: fate.stage, recordedReason: fate.reasonCode,
          failures: buyerGateFailures(fate.signals, fate.level, fate.chainIncomplete, fate.needQuote) });
        if (fate?.stage === "free_rejected" && fate.freeReject === "no_visible_term") {
          const comparison = termScreenComparison(post, arm);
          if (comparison) screenChanges.push({ arm, key: post.key, gold, alternative: "whole-own-post terms only",
            outcome: !comparison.sentence && comparison.wholeOwnPost ? "term rule would pass; judge outcome unknown" : "no term-rule recovery" });
        }
        if (fate?.stage === "free_rejected" && fate.freeReject === "reply_farm") screenChanges.push({ arm, key: post.key, gold,
          alternative: "bypass activity heuristic only", outcome: "first rule bypassed; later screen and judge outcomes unknown (page counts not archived)" });
      }
    }
    return {
      name: product.name, excludedFromValidation: excluded.includes(product.name), rawLabels: tally(selectedLabels),
      reviewedLabels: reviewed.size ? tally(selectedLabels.filter((row) => reviewed.has(row.key))) : tally([]),
      baseline: { all: armMetrics(all, labels, "baseline"), buyerCards: armMetrics(all, labels, "baseline", "lead"), conversationCards: armMetrics(all, labels, "baseline", "reply") },
      probe: { all: armMetrics(all, labels, "probe"), buyerCards: armMetrics(all, labels, "probe", "lead"), conversationCards: armMetrics(all, labels, "probe", "reply") },
      lexical: Object.fromEntries(Object.entries(laneSets).map(([name, lanes]) => [name, lexicalComparison(sampled, labels, lanes)])),
      screenChanges, failures, losses,
      unfinished: Object.fromEntries((["baseline", "probe"] as const).map((arm) => [arm, all.filter((post) => post.arms[arm]?.stage.startsWith("pending_")).length])),
    };
  });
  const validationPosts = snapshot.posts.filter((post) => !excluded.includes(post.product));
  const summary = {
    setupHash: setup.hash, snapshotHash: contentHash, exportedAt: snapshot.exportedAt, provenance: snapshot.provenance,
    labels: { originalModel: tally([...original.values()]), effective: tally([...labels.values()]), reviewed: reviewed.size,
      unlabelledBlind: blind.length - labels.size, highWeightPositives: highWeight.length },
    sampling: { status: sampling ? "v2 post-unit manifest validated; asks/conversations estimated separately; unknown strata are not imputed" : "legacy weights UNVALIDATED: raw post denominators mixed with conversation dedup; no corrected population estimates possible from the labelled sample alone",
      influence, estimates },
    validation: { excluded, baseline: armMetrics(validationPosts, labels, "baseline"), probe: armMetrics(validationPosts, labels, "probe") },
    products,
  };
  writeFileSync(join(out, "analysis.json"), JSON.stringify(summary, null, 2));
  const packet = reviewPacket(blind, original, weights, fates, setup.hash);
  writeFileSync(join(out, "review-packet.jsonl"), packet.packet.map((post) => JSON.stringify(post)).join("\n") + "\n");
  writeFileSync(join(out, "review-selection.json"), JSON.stringify({ packetHash: packet.hash, rows: packet.selection }, null, 2));
  writeFileSync(join(out, "REVIEW-RUBRIC.md"), LABEL_RUBRIC + "\n\nThis packet oversamples suspected positives. Its precision is NOT a population estimate. Selection reasons, model labels and weights are in a separate file; keep them hidden during review. Complete the review page and download adjudications.jsonl, then rerun offline --adjudications <path>. Reviewer identity records attribution, not proof that the reviewer is human.\n");
  writeFileSync(join(out, "review.html"), reviewHtml(packet.packet, packet.hash));
  const lines = [
    `# Buyer-first offline audit: ${tag}`, "",
    `Source: ${snapshot.provenance}. Frozen ${snapshot.exportedAt}; snapshot ${contentHash}; setup ${setup.hash}.`, "",
    `Original independent model labels: ${original.size}; asks ${summary.labels.originalModel.ask}, useful conversations ${summary.labels.originalModel.reply}, not ${summary.labels.originalModel.not}. Human review has NOT occurred through this command. Imported attributed reviews: ${reviewed.size}.`, "",
    `## Measurement limits`, "", `- ${summary.sampling.status}`,
    `- ${highWeight.length} positive model labels have weights greater than one; inspect review-selection.json before relying on legacy loss estimates. Original labels/report remain unchanged.`,
    `- AnyAPI is excluded from the validation aggregate by default. This corpus is already inspected: exploration, not a clean final holdout or global X recall.`,
    `- Buyer fractions below use labelled displayed posts only. Missing labels are shown explicitly; insufficient evidence is not a positive. Wilson ranges are descriptive, not cluster-adjusted population confidence.`,
    `- Recorded rejection reasons are first failures, not causal attribution. Full stored buyer-condition failures are in analysis.json; missing signals/quotes stay unknown.`,
    `- Offline term matches ignore X ranking, query filters, pagination and retrieval depth. Screen bypasses do not predict a final lead.`, "",
    "## Observed displayed posts, by product and arm", "",
    "| Product | Arm | Shown | Ask | Conversation | Not | Insufficient | Unlabelled | Buyer fraction of labelled (descriptive 95% range) | Unique buyer conversations |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|---:|",
  ];
  for (const product of products) for (const arm of ["baseline", "probe"] as const) {
    const m = product[arm].all;
    const interval = m.buyerInterval ? `${Math.round(m.buyerInterval[0] * 100)}–${Math.round(m.buyerInterval[1] * 100)}%` : "—";
    lines.push(`| ${product.name}${product.excludedFromValidation ? " (tuning)" : ""} | ${arm} | ${m.shown} | ${m.ask} | ${m.reply} | ${m.not} | ${m.insufficient} | ${m.unlabelled} | ${pct(m.ask, m.shown - m.unlabelled)} (${interval}) | ${m.uniqueBuyerConversations} |`);
  }
  if (estimates) {
    lines.push("", "## Post-unit estimates (excluded products removed)", "",
      "Estimates are from independently supplied labels, not verified buyers. Ranges sum per-stratum descriptive Wilson ranges; they are NOT a pooled 95% confidence interval or global recall. Census strata are exact within this corpus. Missing/unsampled strata make totals unavailable.", "",
      "| Label | Estimated posts | Descriptive envelope |", "|---|---:|---|");
    for (const estimate of estimates) lines.push(`| ${estimate.gold} | ${estimate.estimate === null ? "unavailable" : estimate.estimate.toFixed(1)} | ${estimate.envelope?.map((n) => n.toFixed(1)).join("–") ?? estimate.unavailable} |`);
  }
  lines.push("", "## Offline lexical candidate selection (labelled sample only)", "",
    "These are post counts, not weighted population recall or final precision. Category-plus-request may be narrower, but candidate precision on this selected sample cannot establish a shipping threshold.", "",
    "| Product | Query shape | Ask | Conversation | Not | Insufficient |", "|---|---|---:|---:|---:|---:|");
  for (const product of products) for (const [shape, comparison] of Object.entries(product.lexical)) {
    lines.push(`| ${product.name} | ${shape} | ${comparison.ask} | ${comparison.reply} | ${comparison.not} | ${comparison.insufficient} |`);
  }
  lines.push("", "## Narrow screening diagnostics (probe; only labelled affected posts)", "",
    "| Alternative | Ask | Conversation | Not | Insufficient | Scope |", "|---|---:|---:|---:|---:|---|");
  for (const alternative of ["whole-own-post terms only", "bypass activity heuristic only"]) {
    const changes = products.filter((product) => !product.excludedFromValidation).flatMap((product) => product.screenChanges)
      .filter((row) => row.arm === "probe" && row.alternative === alternative && !row.outcome.startsWith("no term"));
    const c = tally(changes as AuditLabel[]);
    lines.push(`| ${alternative} | ${c.ask} | ${c.reply} | ${c.not} | ${c.insufficient} | ${alternative.startsWith("whole") ? "Term rule alone; later judge unknown" : "First-rule inventory only; downstream unknown"} |`);
  }
  lines.push("", "## Next decision", "",
    `Review ${packet.packet.length} blind cards in review.html: every original ask, every high-weight positive, plus up to two additional examples per product/stage stratum. Save/download the attributed evidence, then rerun with --adjudications. Do not call these model labels verified buyers.`, "",
    "Before any fresh trial: choose buyer precision / tolerated noise / minimum per-product evidence / spend explicitly; freeze a later time window and unseen products or author/conversation-separated groups. Keep buyer alerts separate from useful conversations. No queries, thresholds, production competitors or paid calls were changed by this offline command.");
  writeFileSync(join(out, "REPORT.md"), lines.join("\n") + "\n");
  console.log(`${labels.size} labels; ${reviewed.size} imported reviews; ${packet.packet.length} blind review cards; output ${out}`);
}
