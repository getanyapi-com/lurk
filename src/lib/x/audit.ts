import { createHash } from "node:crypto";
import { assertLane } from "./grammar";
import { bodyOf, cleanTerm, everydayNames, type SeedSlots } from "./lanes";
import { containsAtWordStart, fold } from "./screen";
import { isAmbiguous, slug } from "./words";

/**
 * The X recall and precision audit (scripts/x-audit.ts). It runs a product
 * twice through the real scan: once on the searches lurk writes for it (the
 * baseline arm) and once on fixed broad searches built from the same site
 * facts (the probe arm), then traces every labelled post to the stage that
 * kept or lost it. Each loss names the part of the pipeline a change would
 * have to touch: the searches (retrieval), the free screen, the judge, or the
 * page depth and cadence.
 *
 * The probe is frozen code, not a model: every term comes from what the
 * project already holds (its competitors, its seed slots, its platforms), in
 * two shapes, the term alone and the term with plain asking words. A model
 * writing the probe would test the model, and the pain lane already showed a
 * model's guesses do not transfer (2026-09-28).
 */

export const PROBE_FAMILY = "probe";
export const PROBE_VERSION = "x-probe-2026-10-06.1";

/** Asking words any buyer writes, whatever the product: none is a category word. */
export const PROBE_ASK_WORDS = [
  "anyone",
  "recommend",
  "recommendations",
  "looking for",
  "best",
  "alternative",
  "alternatives",
  "cheaper",
  "how do",
  "how to",
  "need",
  "suggestions",
];

/** The most site-derived terms a probe searches; each one is two lanes. */
export const MAX_PROBE_TERMS = 20;

const PLATFORM_PHRASING = / (?:api|scraper)$/u;

export type ProbeLane = { family: typeof PROBE_FAMILY; label: string; terms: string[][]; body: string };

/**
 * The terms a probe searches, in a fixed order, taking one in turn from the
 * coined rivals, the platforms the product reads ("tiktok api"), and the seed
 * slots' artifacts and topics.
 * A rival that is an everyday word ("Loom") is left out, since alone it is
 * English and not a product.
 */
export function probeTerms(input: { rivals: string[]; slots: SeedSlots | null; phrasings: string[] }): string[] {
  const everyday = everydayNames(input.slots?.ordinaryWordRivals ?? []);
  const notProducts = new Set((input.slots?.notProducts ?? []).map(slug));
  const rivals = input.rivals.filter((rival) => !isAmbiguous(rival) && !everyday.has(slug(rival)) && !notProducts.has(slug(rival)));
  const platforms = input.phrasings.map((phrasing) => phrasing.toLowerCase().trim()).filter((phrasing) => PLATFORM_PHRASING.test(phrasing));
  // One from each source in turn, so a product with sixteen rivals still
  // probes its own category words: the cap would otherwise go to rivals alone.
  const sources = [rivals, platforms, input.slots?.artifacts ?? [], input.slots?.topics ?? []];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (let index = 0; terms.length < MAX_PROBE_TERMS && sources.some((source) => index < source.length); index += 1) {
    for (const source of sources) {
      const term = index < source.length ? cleanTerm(source[index]) : null;
      if (!term || seen.has(term) || terms.length >= MAX_PROBE_TERMS) continue;
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}

/** Two lanes per term: the term alone, and the term with an asking word. A body X would refuse is dropped. */
export function compileProbeLanes(terms: string[]): ProbeLane[] {
  const lanes: ProbeLane[] = [];
  for (const term of terms) {
    for (const [label, groups] of [
      [`probe: ${term}`, [[term]]],
      [`probe: ${term} + ask`, [[term], PROBE_ASK_WORDS]],
    ] as const) {
      const terms = groups.map((group) => [...group]);
      const body = bodyOf(terms);
      try {
        assertLane(body);
      } catch {
        continue;
      }
      lanes.push({ family: PROBE_FAMILY, label, terms, body });
    }
  }
  return lanes;
}

/** A stable id for a frozen audit setup, so a report can say which one it read. */
export function configHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

/**
 * Whether X's literal search could return this text for these terms: every
 * group shows one alternative at a word start anywhere in the post. Looser
 * than the free screen, which wants one sentence of the author's own words,
 * so the two together tell a search that cannot reach a post from a screen
 * that drops it.
 */
export function textMatches(text: string, terms: string[][]): boolean {
  const folded = fold(text);
  return terms.every((group) =>
    group.some((term) => {
      const wanted = fold(term);
      return wanted.length > 0 && containsAtWordStart(folded, wanted);
    }),
  );
}

/** Independent label for this product; provenance determines whether model or human. */
export type Gold = "ask" | "reply" | "not" | "insufficient";

/** Stable sampling without reading the database or advancing shared dedup state. */
export function shuffled<T>(items: T[], seed: string): T[] {
  let state = Number.parseInt(configHash(seed).slice(0, 8), 16) || 1;
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const other = (state >>> 0) % (index + 1);
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

export type SamplePost = { id: string; stages: string[] };

/**
 * The sampling unit is a product/post, NOT a conversation. Partition the
 * union before sampling: every displayed post is a census, even when one
 * author posts twice in a thread. Conversation dedup belongs in metrics.
 */
export function samplePosts<T extends SamplePost>(posts: T[], seed: string, judgedLimit: number, screenedLimit: number) {
  for (const limit of [judgedLimit, screenedLimit]) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("sample limits must be nonnegative integers");
  }
  if (new Set(posts.map((post) => post.id)).size !== posts.length) throw new Error("duplicate sampling unit");
  const populations = {
    shown: posts.filter((post) => post.stages.some((stage) => SHOWN.has(stage))),
    judged: posts.filter((post) => !post.stages.some((stage) => SHOWN.has(stage)) && post.stages.some((stage) => stage !== "free_rejected")),
    screened: posts.filter((post) => post.stages.length > 0 && post.stages.every((stage) => stage === "free_rejected")),
  };
  if (posts.some((post) => !post.stages.length)) throw new Error("sampling unit has no fate");
  return (Object.keys(populations) as (keyof typeof populations)[]).map((stratum) => {
    const population = populations[stratum];
    const selected = stratum === "shown" ? population : shuffled(population, `${seed}:${stratum}`).slice(0, stratum === "judged" ? judgedLimit : screenedLimit);
    return { stratum, population: population.length, selected, weight: selected.length ? population.length / selected.length : null };
  });
}

/** A post's fate in one arm, read off that arm's x_evaluations row (or its absence). */
export type ArmFate =
  | { fetched: false }
  | { fetched: true; stage: string; freeReject: string | null; reasonCode: string | null; laneLabel: string | null };

/**
 * Where the baseline lost or kept a post, as the part of the pipeline a fix
 * would touch:
 * - shown: it reached the tab as an ask or a reply.
 * - not_reachable: no baseline search's words are in it, so no page depth
 *   would have found it; the searches need different words.
 * - not_reached: a baseline search's words are in it but no page held it;
 *   page depth, cadence or X's own ranking.
 * - screened: the free screen dropped it, by rule.
 * - judged_out: the judge (or the reply check) turned it away, by reason.
 * - unfinished: still waiting on a lookup or a model call when the audit read it.
 */
export type Loss =
  | { at: "shown" }
  | { at: "not_reachable" }
  | { at: "not_reached"; lanes: string[] }
  | { at: "screened"; rule: string }
  | { at: "judged_out"; reason: string }
  | { at: "unfinished"; stage: string };

export const SHOWN = new Set(["lead", "reply"]);
const JUDGED_OUT = new Set(["rejected", "review", "merged", "expired"]);

export function lossOf(
  fate: ArmFate,
  text: string,
  lanes: { label: string; terms: string[][] }[],
): Loss {
  if (!fate.fetched) {
    const matching = lanes.filter((lane) => textMatches(text, lane.terms)).map((lane) => lane.label);
    return matching.length > 0 ? { at: "not_reached", lanes: matching } : { at: "not_reachable" };
  }
  if (SHOWN.has(fate.stage)) return { at: "shown" };
  if (fate.stage === "free_rejected") return { at: "screened", rule: fate.freeReject ?? "unknown" };
  if (JUDGED_OUT.has(fate.stage)) return { at: "judged_out", reason: fate.reasonCode ?? fate.stage };
  return { at: "unfinished", stage: fate.stage };
}

/** The key a loss is counted under in the report: "screened:listicle", "judged_out:no_active_need". */
export function lossKey(loss: Loss): string {
  if (loss.at === "screened") return `screened:${loss.rule}`;
  if (loss.at === "judged_out") return `judged_out:${loss.reason}`;
  if (loss.at === "unfinished") return `unfinished:${loss.stage}`;
  return loss.at;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "is", "it", "i", "you", "we", "my", "our", "your",
  "this", "that", "with", "be", "are", "was", "but", "so", "if", "just", "do", "have", "has", "not", "can", "me", "they",
  "what", "how", "from", "as", "by", "all", "any", "about", "there", "their", "them", "would", "will", "get", "like", "s", "t",
]);

/** The words and word pairs of a post, once each, without handles, links or stop words. */
export function grams(text: string): Set<string> {
  const words = fold(text.replace(/https?:\/\/\S+/gu, " ").replace(/@\w+/gu, " "))
    .split(" ")
    .filter(Boolean);
  const out = new Set<string>();
  // A one-letter word is no term alone, but it starts one: "x api".
  words.forEach((word, index) => {
    if (!STOP.has(word) && word.length > 1) out.add(word);
    const next = words[index + 1];
    if (next && !(STOP.has(word) && STOP.has(next))) out.add(`${word} ${next}`);
  });
  return out;
}

export type Lift = { gram: string; positives: number; negatives: number; lift: number };

/**
 * Words and pairs over-represented in posts a person called an ask or a reply,
 * against the ones they called not, with add-one smoothing. A term must show
 * in at least `minPositives` positive posts by different authors, so one
 * author or one campaign cannot make a winner; with a handful of positives a
 * week this is a list to read, never one to search with unread.
 */
export function termLift(
  posts: { text: string; author: string; gold: Gold }[],
  minPositives = 2,
): Lift[] {
  const positives = posts.filter((post) => post.gold === "ask" || post.gold === "reply");
  const negatives = posts.filter((post) => post.gold === "not");
  if (positives.length === 0) return [];
  const authorsWith = new Map<string, Set<string>>();
  const negativeCount = new Map<string, number>();
  for (const post of positives) {
    for (const gram of grams(post.text)) {
      const authors = authorsWith.get(gram) ?? new Set<string>();
      authors.add(post.author.toLowerCase());
      authorsWith.set(gram, authors);
    }
  }
  for (const post of negatives) {
    for (const gram of grams(post.text)) negativeCount.set(gram, (negativeCount.get(gram) ?? 0) + 1);
  }
  const lifts: Lift[] = [];
  for (const [gram, authors] of authorsWith) {
    if (authors.size < minPositives) continue;
    const pos = authors.size;
    const neg = negativeCount.get(gram) ?? 0;
    const lift = ((pos + 1) / (positives.length + 2)) / ((neg + 1) / (negatives.length + 2));
    lifts.push({ gram, positives: pos, negatives: neg, lift: Math.round(lift * 100) / 100 });
  }
  return lifts.sort((a, b) => b.lift - a.lift || b.positives - a.positives);
}

/**
 * What a labeller is told, written beside every sample so each audit is
 * labelled by the same rule. Labels come from people or Claude agents reading
 * blind, never from lurk's own judge: the audit measures the judge.
 */
export const LABEL_RUBRIC = `Label each post in to-label.jsonl for the product on its line. You see no arm and no verdict; keep it that way. Labels are independent judgments, not human ground truth unless a human actually reviews them.

- "ask": the author has a current need this product could fill and is looking for a way to fill it: asking for a tool, an API or an alternative, complaining about what they pay or use now while wanting something else, or asking how to do this job. The founder replying "we do this" would be welcome.
- "reply": a useful conversation but no evidenced current buying intent. A product reply directly helps with the described job or pain. Mere topic overlap, market news, or a large audience is not enough. Never a vendor's own promotion. Report separately from buyer leads.
- "not": everything else: vendors and agencies pitching, jobs and gigs, news, listicles, spam, the words used for something else, someone content with what they have, crypto, jokes.
- "insufficient": the available text and product facts cannot establish a verdict; do not invent missing context or product capabilities.

For ask, record the exact author need, a capability supported by the product facts, why the need is unresolved, and how replying helps. For reply, record the supported capability and how replying helps. Use insufficient when evidence is missing. Judge only from the supplied text and product facts.

Write labels.jsonl beside it, one line per post: {"key": "<key>", "gold": "ask" | "reply" | "not" | "insufficient", "note": "<why>", "evidence": {"need": "<author quote>", "capability": "<product fact>", "unresolved": "<evidence>", "help": "<why the reply helps>"}}. Do not call a model-generated label human-verified.`;
