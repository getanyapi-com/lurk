import { googleQuery } from "@/lib/seo/fetch";
import { cityPart, familyKey, meaningWords } from "./phrases";

/**
 * The Google searches discovery buys. Half ask the problem in the buyer's own
 * words with no place in them, half ask it about one place this product's page
 * names. Both are aimed at Reddit through the app's one Google question, so a
 * phrasing the Reddit SEO tab has already bought is free here. Nothing here
 * invents a phrasing or a place: every query is built from what the product
 * page itself said.
 */

/** A place this product serves, with the page text it was read from. */
export type Destination = { name: string; sourceText: string };

export type QueryKind = "problem" | "destination";

export type DiscoveryQuery = {
  query: string;
  /** The problem family this query asks about, which its evidence inherits. */
  family: string;
  /** The place it asks about, or null for a query with no place in it. */
  destination: string | null;
  kind: QueryKind;
};

/**
 * How many new relevant threads a round of expansion has to find to be worth
 * another one. Two rounds under this is the plan's stop rule.
 */
export const MIN_NEW_RELEVANT = 2;

/**
 * One query: the phrasing exactly as the buyer would say it, and the city if
 * this query is about a place. The phrasing is not rewritten, because Google
 * answers a question and not a bag of words, and the words a person leaves out
 * of "hotels that allow 18 year olds" are the ones that make it a search.
 */
function problemQuery(phrasing: string, destination: string | null): DiscoveryQuery {
  const body = phrasing.trim().replace(/\s+/g, " ");
  const place = destination === null ? "" : cityPart(destination);
  return {
    query: googleQuery([body, place].filter(Boolean).join(" ")),
    family: familyKey(phrasing),
    destination,
    kind: destination === null ? "problem" : "destination",
  };
}

function unique(queries: DiscoveryQuery[]): DiscoveryQuery[] {
  const seen = new Set<string>();
  return queries.filter((item) => {
    if (seen.has(item.query)) {
      return false;
    }
    seen.add(item.query);
    return true;
  });
}

export type QueryPlanInput = {
  problemPhrasings: string[];
  destinations: Destination[];
  /** The tier's discovery budget: how many place queries this first pass buys. */
  budget: number;
};

/**
 * The opening set: every way the page says its buyers ask, each asked once with
 * no place in it, and then the places the page names, in the order it names
 * them. Every phrasing is asked because one that is never asked can never earn
 * a search, and the phrasings are what the page itself produced: a product that
 * works with ten platforms says so in ten ways, and on 2026-09-14 nine of
 * getanyapi.com's twenty-one went unasked under a flat budget, which is why it
 * had no search for LinkedIn, YouTube or Facebook. One Google query is $0.0005.
 * The tier's budget governs the places, which are the open-ended half: a
 * product selling in twenty cities cannot spend a whole discovery on them.
 */
export function buildDiscoveryQueries(input: QueryPlanInput): DiscoveryQuery[] {
  const phrasings = input.problemPhrasings.filter((phrase) => meaningWords(phrase).length > 0);
  if (phrasings.length === 0) {
    return [];
  }
  const problem = phrasings.map((phrase) => problemQuery(phrase, null));
  const destination = input.destinations
    .slice(0, Math.max(input.budget, 0))
    .map((place, index) => problemQuery(phrasings[index % phrasings.length], place.name));
  return unique([...problem, ...destination]);
}

/** How much relevant evidence each family and each place has produced so far. */
export type Coverage = {
  families: Record<string, number>;
  destinations: Record<string, number>;
};

export type ExpansionInput = QueryPlanInput & {
  /** Every query already bought for this project. */
  used: DiscoveryQuery[];
  coverage: Coverage;
  /** The tier's hard maximum: used and proposed together may not pass it. */
  max: number;
};

function pairKey(family: string, destination: string | null): string {
  return `${family}|${destination ?? ""}`;
}

/**
 * What to ask next, in the order the plan spends on: first the problem family
 * that no thread has answered yet, because a demand with no evidence is the
 * hole worth buying; then the places the page names, in the order it names
 * them, each with the next phrasing in turn. One round is one rotation of the
 * phrasings, so a product that lists twenty cities asks a few of them, is
 * judged by the stop rule, and leaves the rest to the weekly refresh instead
 * of spending its whole maximum on city after city with the same sentence.
 */
export function expandDiscoveryQueries(input: ExpansionInput): DiscoveryQuery[] {
  const room = input.max - input.used.length;
  const phrasings = input.problemPhrasings.filter((phrase) => meaningWords(phrase).length > 0);
  if (room <= 0 || phrasings.length === 0) {
    return [];
  }
  const askedPairs = new Set(input.used.map((item) => pairKey(item.family, item.destination)));
  const familyCover = (phrase: string) => input.coverage.families[familyKey(phrase)] ?? 0;
  const placeCover = (name: string) => input.coverage.destinations[name] ?? 0;

  const proposals: DiscoveryQuery[] = [];
  const provenPlaces = [...input.destinations].sort(
    (left, right) => placeCover(right.name) - placeCover(left.name),
  );
  for (const phrase of phrasings.filter((item) => familyCover(item) === 0)) {
    const family = familyKey(phrase);
    if (!askedPairs.has(pairKey(family, null))) {
      proposals.push(problemQuery(phrase, null));
      continue;
    }
    const place = provenPlaces.find((item) => !askedPairs.has(pairKey(family, item.name)));
    if (place) {
      proposals.push(problemQuery(phrase, place.name));
    }
  }

  let turn = 0;
  for (const place of input.destinations.filter((item) => placeCover(item.name) === 0)) {
    for (let tried = 0; tried < phrasings.length; tried += 1) {
      const phrase = phrasings[turn % phrasings.length];
      turn += 1;
      if (!askedPairs.has(pairKey(familyKey(phrase), place.name))) {
        proposals.push(problemQuery(phrase, place.name));
        break;
      }
    }
  }
  return unique(proposals).slice(0, Math.min(room, phrasings.length));
}

/**
 * Whether expansion has stopped paying for itself: two rounds in a row that
 * each found fewer than MIN_NEW_RELEVANT new relevant threads.
 */
export function expansionShouldStop(newRelevantPerRound: number[]): boolean {
  const last = newRelevantPerRound.slice(-2);
  return last.length === 2 && last.every((count) => count < MIN_NEW_RELEVANT);
}
