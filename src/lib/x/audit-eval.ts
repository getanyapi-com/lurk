import { configHash, shuffled, textMatches, type Gold } from "./audit";
import { type XSignals } from "./gates";
import { ownWords, type XPost } from "./map";
import { matchedLaneTerms } from "./screen";

export type AuditArm = "baseline" | "probe";
export type AuditLabel = { key: string; gold: Gold; note?: string };
export type Adjudication = AuditLabel & {
  reviewer: string;
  evidence?: { need?: string; capability?: string; unresolved?: string; help?: string };
};
export type BlindPost = {
  key: string;
  product: { name: string; url: string | null; pain: string | null; solution: string | null; targetUsers: string | null };
  post: { text: string; author: string; url: string; created: string };
  replyingTo?: { author: string; text: string };
};
export type SnapshotPost = {
  key: string;
  product: string;
  tweet: string;
  text: string;
  author: string;
  created: string;
  conversation: string | null;
  isReply: boolean;
  arms: Partial<Record<AuditArm, {
    stage: string;
    freeReject: string | null;
    reasonCode: string | null;
    score: number | null;
    lane: { family: string; label: string; terms: string[][] } | null;
    signals: XSignals | null;
    level: string | null;
    needQuote: string | null;
    chainIncomplete: boolean | null;
  }>>;
};

/** Split only on LF: U+2028 inside a JSON string is valid, not a JSONL separator. */
export function parseJsonl<T>(text: string): T[] {
  return text.split("\n").filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) as T; }
    catch { throw new Error(`invalid JSONL record ${index + 1}`); }
  });
}

export function keyed<T extends { key: string }>(rows: T[], name: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (typeof row.key !== "string" || !row.key || map.has(row.key)) throw new Error(`${name}: missing or duplicate key`);
    map.set(row.key, row);
  }
  return map;
}

export function validateLabel(label: AuditLabel): void {
  if (!["ask", "reply", "not", "insufficient"].includes(label.gold)) throw new Error(`${label.key}: invalid label`);
}

export function validateAdjudication(label: Adjudication): void {
  validateLabel(label);
  if (!label.reviewer?.trim()) throw new Error(`${label.key}: reviewer is required`);
  const required = label.gold === "ask" ? ["need", "capability", "unresolved", "help"] as const
    : label.gold === "reply" ? ["capability", "help"] as const : [];
  for (const field of required) {
    if (!label.evidence?.[field]?.trim()) throw new Error(`${label.key}: ${field} evidence is required`);
  }
  if (!label.note?.trim()) throw new Error(`${label.key}: review explanation is required`);
}

/** Product/author/conversation is a metric unit, never a sampling denominator. */
export function conversationKey(post: SnapshotPost): string {
  return `${post.key.slice(0, post.key.lastIndexOf(":"))}:${post.conversation ?? post.tweet}:${post.author.toLowerCase()}`;
}

export function wilson(successes: number, total: number): [number, number] | null {
  if (!total) return null;
  const z = 1.959963984540054;
  const p = successes / total;
  const divisor = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / divisor;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / divisor;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export type SampleStratum = { product: string; unit: string; stratum: string; population: number; sampled: number; weight: number | null; keys: string[] };

/** Only version-2 post-unit manifests can estimate totals; never repair legacy weights by guessing. */
export function stratifiedTotals(strata: SampleStratum[], labels: Map<string, AuditLabel>) {
  const seen = new Set<string>();
  for (const stratum of strata) {
    const { population: n, sampled: k, weight } = stratum;
    if (stratum.unit !== "product_post" || !Number.isSafeInteger(n) || !Number.isSafeInteger(k) || k < 0 || n < k || stratum.keys.length !== k ||
      (k ? weight !== n / k : weight !== null)) throw new Error("invalid post-unit sampling manifest");
    for (const key of stratum.keys) {
      if (seen.has(key)) throw new Error("sampling strata overlap");
      seen.add(key);
    }
  }
  return (["ask", "reply", "not", "insufficient"] as const).map((gold) => {
    let total = 0;
    let lower = 0;
    let upper = 0;
    for (const stratum of strata) {
      if (!stratum.population) continue;
      if (!stratum.sampled || stratum.keys.some((key) => !labels.has(key))) return { gold, estimate: null, envelope: null, unavailable: "unsampled or unlabelled stratum" };
      const count = stratum.keys.filter((key) => labels.get(key)!.gold === gold).length;
      total += count * stratum.weight!;
      const interval = stratum.sampled === stratum.population ? [count / stratum.sampled, count / stratum.sampled] : wilson(count, stratum.sampled)!;
      lower += interval[0] * stratum.population;
      upper += interval[1] * stratum.population;
    }
    // These are sums of per-stratum descriptive Wilson ranges, NOT a pooled 95% CI.
    return { gold, estimate: total, envelope: [lower, upper], unavailable: null };
  });
}

/** All failed buyer conditions, not just decide()'s first reason. No changed thresholds. */
export function buyerGateFailures(signals: XSignals, level: string | null, chainIncomplete: boolean | null, needQuote: string | null): string[] {
  const failures: string[] = [];
  if (signals.ownNeed < 0.5) failures.push("own_need");
  if (signals.sameKind < 0.5) failures.push("same_kind");
  if (signals.rivalVendor >= 0.5) failures.push("rival_vendor");
  if (signals.resolved >= 0.5) failures.push("resolved");
  if (level === "complete" && (signals.automatedAccount ?? 0) >= 0.5) failures.push("automated_account");
  if (signals.offersServices >= 0.5) failures.push("offers_services");
  if (signals.curiosity >= 0.5) failures.push("curiosity");
  if (signals.promoting >= 0.5) failures.push("promoting");
  if (signals.canUse < 0.5) failures.push("can_use");
  if (signals.intent < 2) failures.push("intent");
  if (chainIncomplete) failures.push("chain_incomplete");
  if (!needQuote) failures.push("missing_need_quote");
  return failures;
}

export function armMetrics(posts: SnapshotPost[], labels: Map<string, AuditLabel>, arm: AuditArm, stage?: "lead" | "reply") {
  const shown = posts.filter((post) => stage ? post.arms[arm]?.stage === stage : ["lead", "reply"].includes(post.arms[arm]?.stage ?? ""));
  const counts = { ask: 0, reply: 0, not: 0, insufficient: 0, unlabelled: 0 };
  const buyers = new Set<string>();
  const conversations = new Set<string>();
  for (const post of shown) {
    const label = labels.get(post.key);
    if (!label) { counts.unlabelled += 1; continue; }
    counts[label.gold] += 1;
    if (label.gold === "ask") buyers.add(conversationKey(post));
    if (label.gold === "reply") conversations.add(conversationKey(post));
  }
  const labelled = shown.length - counts.unlabelled;
  // Unknown labels stay in the denominator; they are NOT silently positive.
  const noise = counts.not;
  return {
    shown: shown.length, ...counts, uniqueBuyerConversations: buyers.size, uniqueUsefulConversations: conversations.size,
    observedBuyerFraction: labelled ? counts.ask / labelled : null,
    buyerInterval: wilson(counts.ask, labelled),
    noiseAmongLabelled: noise,
    unverifiedAmongLabelled: counts.insufficient,
    noiseBounds: [noise, noise + counts.insufficient + counts.unlabelled],
    // A proxy, not a replay of the tab: same stored scores, only known labels.
    topFiveStoredScore: [...shown].sort((a, b) => (b.arms[arm]?.score ?? -1) - (a.arms[arm]?.score ?? -1) || a.key.localeCompare(b.key))
      .slice(0, 5).map((post) => ({ key: post.key, gold: labels.get(post.key)?.gold ?? "unlabelled" })),
  };
}

export function lexicalComparison(posts: SnapshotPost[], labels: Map<string, AuditLabel>, lanes: { label: string; terms: string[][] }[]) {
  const counts = { ask: 0, reply: 0, not: 0, insufficient: 0 };
  const matched: string[] = [];
  for (const post of posts) {
    const label = labels.get(post.key);
    if (!label || !lanes.some((lane) => textMatches(post.text, lane.terms))) continue;
    counts[label.gold] += 1;
    matched.push(post.key);
  }
  return { ...counts, matched };
}

/** Narrow term-only counterfactual; venue's other screens/route are NOT changed. */
export function termScreenComparison(post: SnapshotPost, arm: AuditArm) {
  const fate = post.arms[arm];
  if (!fate?.lane) return null;
  const input: XPost = {
    id: post.tweet, text: post.text, isReply: post.isReply, createdAt: new Date(post.created),
    authorUsername: post.author, conversationId: post.conversation,
    lang: null, authorName: null, authorId: null, authorImage: null, authorFollowers: null,
    authorVerified: null, inReplyToId: null, likeCount: null, replyCount: null, retweetCount: null,
    quoteCount: null, viewCount: null, bookmarkCount: null, mediaCount: null,
  };
  return {
    sentence: matchedLaneTerms(input, fate.lane.terms, false) !== null,
    wholeOwnPost: matchedLaneTerms(input, fate.lane.terms, true) !== null,
    ownWords: ownWords(input),
  };
}

/** Selection reasons are stored in a separate file, never in the blind packet. */
export function reviewPacket(posts: BlindPost[], labels: Map<string, AuditLabel>, weights: Record<string, number>, fates: Map<string, SnapshotPost>, seed: string, perStratum = 2) {
  const selected = new Map<string, Set<string>>();
  const add = (post: BlindPost, reason: string) => {
    const reasons = selected.get(post.key) ?? new Set<string>();
    reasons.add(reason); selected.set(post.key, reasons);
  };
  for (const post of posts) {
    const label = labels.get(post.key);
    if (label?.gold === "ask") add(post, "all_model_asks");
    if (label && ["ask", "reply"].includes(label.gold) && (weights[post.key] ?? 1) > 1) add(post, "all_high_weight_positives");
  }
  const strata = new Map<string, BlindPost[]>();
  for (const post of posts) {
    const fate = fates.get(post.key);
    const stages = Object.values(fate?.arms ?? {}).map((arm) => arm.stage);
    const bucket = stages.some((stage) => stage === "lead" || stage === "reply") ? "shown"
      : stages.some((stage) => stage !== "free_rejected") ? "judged_or_unfinished" : stages.length ? "screened" : "unknown";
    const key = `${post.product.name}:${bucket}`;
    strata.set(key, [...(strata.get(key) ?? []), post]);
  }
  for (const [stratum, pool] of strata) {
    for (const post of shuffled(pool.filter((post) => !selected.has(post.key)), `${seed}:${stratum}`).slice(0, perStratum)) add(post, `stratified:${stratum}`);
  }
  const packet = shuffled(posts.filter((post) => selected.has(post.key)), `${seed}:blind-review`)
    .map((post, index) => ({ ...post, reviewId: `R${String(index + 1).padStart(3, "0")}` }));
  return {
    packet,
    selection: packet.map((post) => ({ reviewId: post.reviewId, key: post.key, reasons: [...selected.get(post.key)!] })),
    hash: configHash(packet),
  };
}
