import type { Answers } from "../../src/lib/jev";
import type { ProductFacts } from "../../src/lib/product";
import type { XLevel } from "../../src/lib/x/gates";

export type BriefWarning = {
  neighbour: string;
  kind: string;
  whyNot: string;
  competitors: string[];
  capabilities: Array<{ text: string; sharedWords: string[] }>;
};

const words = (text: string) => text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const generic = new Set("a an the and or for of with without to in on like general standalone dedicated tool tools app apps software platform service services free paid online existing".split(" "));
/** Shallow inflections only (editing/edit, recordings/record); not semantic matching. */
const stem = (word: string) => {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 6 && word.endsWith("er")) return word.slice(0, -2);
  return word;
};

/** Lexical review flags, never proof that an adjacent market is a buyer fit. */
export function briefWarnings(facts: ProductFacts): BriefWarning[] {
  return (facts.brief?.neighbours ?? []).flatMap((neighbour, index) => {
    const kind = words(neighbour.kind);
    const content = new Set(kind.filter((word) => !generic.has(word)).map(stem));
    const competitors = facts.competitors.filter((competitor) => {
      const term = words(competitor);
      return term.length > 0 && kind.some((_, start) => term.every((word, offset) => kind[start + offset] === word));
    });
    const capabilities = facts.capabilities.flatMap((text) => {
      const capability = new Set(words(text).map(stem));
      const sharedWords = [...content].filter((word) => capability.has(word));
      return sharedWords.length >= 2 && sharedWords.length / content.size >= 0.5 ? [{ text, sharedWords }] : [];
    });
    return competitors.length || capabilities.length ? [{ neighbour: `n${index}`, ...neighbour, competitors, capabilities }] : [];
  });
}

export type ReplayVerdict = { decision: string; stage: string; code: string };
const number = (answers: Answers, key: string) => answers[key]?.type === "noul" ? answers[key].noul : null;

/**
 * Hypothetical reason/routing change only. The ordinary judge must otherwise
 * qualify the post after omitting ONLY the neighbour answer; every seller,
 * quote, audience, context and mandatory-requirement check still applies.
 * A conflict stays unqualified. No production code calls this helper.
 */
export function positioningReplay(
  answers: Answers,
  level: XLevel,
  before: ReplayVerdict,
  withoutNeighbour: ReplayVerdict | null,
): ReplayVerdict {
  const wanted = answers.wanted_kind;
  const requirement = answers.hard_requirement;
  if (wanted?.type !== "choice" || !/^n\d+$/u.test(wanted.choice) || before.code !== "wrong_job" ||
      before.decision !== "review" || withoutNeighbour?.decision !== "qualify" ||
      (number(answers, "same_kind") ?? -1) < 0.5 || (number(answers, "wants_offering") ?? -1) < 0.5 ||
      requirement?.type !== "choice" || !["met", "none_stated"].includes(requirement.choice)) return before;
  return { decision: "review", stage: level === "complete" ? "review" : "pending_context", code: "positioning_conflict" };
}
