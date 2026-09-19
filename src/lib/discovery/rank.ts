import { competitorHost, matchCompetitorDomain } from "@/lib/competitors/host";
import type { EntityRole, Relevance, ThreadLabel } from "./label";
import type { Coverage } from "./queries";
import {
  cityPart,
  collapseDestinations,
  isNumberWord,
  meaningWords,
  stripRedditSuffix,
  words,
} from "./phrases";

/**
 * Turning Google evidence into a plan: which communities are worth reading,
 * which phrases are worth searching for, and which named products are really
 * substitutes. Every function here is pure, so the arithmetic that decides a
 * project's whole retrieval plan can be argued with in a test.
 */

/** What one relevant thread is worth against one that only might be. */
export const RELEVANCE_WEIGHT: Record<Relevance, number> = {
  relevant: 1,
  plausible: 0.5,
  irrelevant: 0,
  unlabeled: 0,
};

/** One observation, as either the database or a fixture supplies it. */
export type EvidenceLike = {
  postId: string;
  subreddit: string;
  query: string;
  family: string | null;
  destination: string | null;
  position: number | null;
  title: string | null;
  snippet: string | null;
  relevance: string;
};

/** One thread, however many queries returned it. */
export type ThreadEvidence = {
  postId: string;
  subreddit: string;
  title: string;
  snippet: string;
  weight: number;
  bestPosition: number;
  families: string[];
  destinations: string[];
};

function weightOf(relevance: string): number {
  return RELEVANCE_WEIGHT[relevance as Relevance] ?? 0;
}

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** The unique threads behind a set of observations, best rank kept. */
export function dedupeThreads(rows: EvidenceLike[]): ThreadEvidence[] {
  const byPost = new Map<string, EvidenceLike[]>();
  for (const row of rows) {
    byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), row]);
  }
  return [...byPost.entries()].map(([postId, group]) => ({
    postId,
    subreddit: group[0].subreddit.toLowerCase(),
    title: stripRedditSuffix(group[0].title ?? ""),
    snippet: group[0].snippet ?? "",
    weight: Math.max(...group.map((row) => weightOf(row.relevance))),
    bestPosition: Math.min(...group.map((row) => row.position ?? Number.MAX_SAFE_INTEGER)),
    families: distinct(group.map((row) => row.family)),
    destinations: distinct(group.map((row) => row.destination)),
  }));
}

/** True when this query asked about one of the places the product page named. */
export function isDestinationQuery(query: string, destinations: string[]): boolean {
  const asked = words(query).join(" ");
  return destinations.some((name) => {
    const place = words(cityPart(name)).join(" ");
    return place.length > 0 && asked.includes(place);
  });
}

export type CommunityRank = {
  name: string;
  /** Unique relevant threads, a plausible one counting half. */
  weighted: number;
  /** How many different problem families this community answered. */
  families: number;
  /** Relevant share of what it produced, smoothed so one lucky hit cannot win. */
  fraction: number;
  bestPosition: number;
  threads: number;
};

function statsFor(rows: EvidenceLike[]): CommunityRank[] {
  const threads = dedupeThreads(rows);
  const byCommunity = new Map<string, ThreadEvidence[]>();
  for (const thread of threads) {
    byCommunity.set(thread.subreddit, [...(byCommunity.get(thread.subreddit) ?? []), thread]);
  }
  return [...byCommunity.entries()].map(([name, group]) => {
    const weighted = group.reduce((total, thread) => total + thread.weight, 0);
    return {
      name,
      weighted,
      families: distinct(group.filter((thread) => thread.weight > 0).flatMap((t) => t.families))
        .length,
      fraction: (weighted + 1) / (group.length + 2),
      bestPosition: Math.min(...group.map((thread) => thread.bestPosition)),
      threads: group.length,
    };
  });
}

/** Best community first: most relevant evidence, then breadth, then rank. */
export function compareCommunities(left: CommunityRank, right: CommunityRank): number {
  return (
    right.weighted - left.weighted ||
    right.families - left.families ||
    right.fraction - left.fraction ||
    left.bestPosition - right.bestPosition ||
    left.name.localeCompare(right.name)
  );
}

/**
 * The community order for the plan. The two kinds of query are ranked apart
 * and then interleaved, because a product selling in twenty cities returns far
 * more city threads than problem threads: combined in one pile, the community
 * where the problem is actually discussed would never reach the top.
 */
export function rankCommunities(rows: EvidenceLike[], destinations: string[]): CommunityRank[] {
  const broad = statsFor(rows.filter((row) => !isDestinationQuery(row.query, destinations)))
    .sort(compareCommunities);
  const placed = statsFor(rows.filter((row) => isDestinationQuery(row.query, destinations)))
    .sort(compareCommunities);
  const combined = new Map(statsFor(rows).map((item) => [item.name, item]));
  const order: string[] = [];
  for (let index = 0; index < Math.max(broad.length, placed.length); index += 1) {
    for (const side of [broad[index], placed[index]]) {
      if (side && !order.includes(side.name)) {
        order.push(side.name);
      }
    }
  }
  return order.map((name) => combined.get(name)).filter((item): item is CommunityRank => Boolean(item));
}

/** One side's communities on their own, best first. */
export function rankSide(rows: EvidenceLike[]): CommunityRank[] {
  return statsFor(rows).sort(compareCommunities);
}

/**
 * How much relevant evidence each family and each place has produced, which is
 * what decides whether expansion is still worth buying.
 */
export function coverageFrom(rows: EvidenceLike[]): Coverage {
  const coverage: Coverage = { families: {}, destinations: {} };
  for (const thread of dedupeThreads(rows)) {
    if (thread.weight <= 0) {
      continue;
    }
    for (const family of thread.families) {
      coverage.families[family] = (coverage.families[family] ?? 0) + 1;
    }
    for (const place of thread.destinations) {
      coverage.destinations[place] = (coverage.destinations[place] ?? 0) + 1;
    }
  }
  return coverage;
}

export type FamilyRank = {
  family: string;
  weighted: number;
  /** The buyer's own words, with the city taken out so one demand is one family. */
  phrases: string[];
  /** The phrasing whose own query earned this family its evidence, if one did. */
  asked: string | null;
};

/** One phrasing as it is asked: the buyer's words, with the spacing tidied. */
export function askedText(phrase: string): string {
  return phrase.trim().replace(/\s+/g, " ");
}

/**
 * The longest a phrasing may be before Reddit's own search stops answering it.
 * Google reads a sentence for its meaning; Reddit search matches words, so a
 * sentence's ordinary words match most of the site. Measured 2026-09-14, the
 * top twelve results of each search, counting the ones about the product's own
 * problem: "reddit scraper" and "linkedin scraper" 12 of 12, "email
 * verification api" 12, "google maps scraper api" 12; then "need data without
 * another subscription" 0, "scraper failed and returned nothing" 3, "pay per
 * request instead of subscription" 3, "another provider means another schema
 * again" 1 - that one returns Schema Therapy. Four words held, five drifted.
 */
export const REDDIT_SEARCH_WORDS = 4;

/**
 * Whether Reddit search can be asked this phrasing as it stands. A phrasing it
 * cannot is not lost: Google still asks it in discovery and in the Reddit SEO
 * tab, which is where a sentence belongs.
 */
export function redditCanSearch(phrase: string): boolean {
  return words(phrase).length <= REDDIT_SEARCH_WORDS;
}

/**
 * Which phrasing actually earned this family its evidence. A family key is the
 * first three meaning words of a phrasing, so two phrasings collide on one key:
 * "reddit scraper api for comments" and "reddit scraper api for images" are one
 * family, and the key alone cannot say which of them Google answered. Every
 * observation carries the query it came from, and a query carries its phrasing
 * verbatim, so the strongest thread the labels kept names its own phrasing. A
 * thread Google's labels called plausible counts, on the same weighting the
 * rest of the ranking uses.
 */
function askedPhrasing(rows: EvidenceLike[], phrasings: string[]): string | null {
  const ordered = rows
    .filter((row) => weightOf(row.relevance) > 0)
    .sort(
      (left, right) =>
        weightOf(right.relevance) - weightOf(left.relevance) ||
        (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER),
    );
  for (const row of ordered) {
    const asked = phrasings
      .map(askedText)
      .find((phrase) => row.query.includes(phrase) && redditCanSearch(phrase));
    if (asked) {
      return asked;
    }
  }
  return null;
}

/** The problem families the evidence supports, strongest first. */
export function rankFamilies(
  rows: EvidenceLike[],
  destinations: string[],
  phrasings: string[],
): FamilyRank[] {
  const byFamily = new Map<string, EvidenceLike[]>();
  for (const row of rows) {
    if (!row.family) {
      continue;
    }
    byFamily.set(row.family, [...(byFamily.get(row.family) ?? []), row]);
  }
  return [...byFamily.entries()]
    .map(([family, group]) => {
      const threads = dedupeThreads(group);
      const evidence = threads
        .filter((thread) => thread.weight > 0)
        .sort((left, right) => right.weight - left.weight || left.bestPosition - right.bestPosition);
      return {
        family,
        weighted: evidence.reduce((total, thread) => total + thread.weight, 0),
        phrases: distinct(
          evidence.map((thread) => collapseDestinations(thread.title, destinations)),
        ),
        asked: askedPhrasing(group, phrasings),
      };
    })
    .sort((left, right) => right.weighted - left.weighted || left.family.localeCompare(right.family));
}

/**
 * Words that say a demand is a refusal rather than a topic. None of them is a
 * constraint on its own: `(api) AND (without)` means every post about an API,
 * and on 2026-09-14 that search and its two siblings produced 0, 0 and 1 leads
 * on lurk.so against 7 for `instagram api` and 5 for `tiktok scraper`. They are
 * still kept out of the subject, because a search anchored on "not" finds
 * nothing about anything.
 */
const NEGATIONS = new Set(["no", "non", "not", "without", "cannot", "cant", "wont"]);

/**
 * Words a Reddit title repeats because it is a Reddit title, not because it is
 * what the thread is about. Any of these as the anchor turns the search into
 * "(reddit) AND (...)", which matches the whole site and finds nobody.
 */
const NOT_AN_ANCHOR = new Set([
  "advice", "anyone", "askreddit", "help", "please", "post", "question", "questions",
  "reddit", "sub", "subreddit", "thanks", "thread", "tips",
]);

/** A constraint said in more than one word, kept whole so Reddit matches it. */
function multiWordConstraints(tokens: string[]): string[] {
  const found: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = `${tokens[index]} ${tokens[index + 1]}`;
    if (
      (["under", "over", "below", "above"].includes(tokens[index]) &&
        isNumberWord(tokens[index + 1])) ||
      pair === "check in"
    ) {
      found.push(pair);
    }
  }
  return found;
}

/** Singular and plural are one term; the query asks for both spellings. */
function stemOf(word: string): string {
  return word.replace(/(ies|es|s)$/, (ending) => (ending === "ies" ? "y" : ""));
}

function countByPhrase(perPhrase: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const terms of perPhrase) {
    for (const term of new Set(terms)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return counts;
}

function orClause(terms: string[]): string {
  return `(${terms.join(" OR ")})`;
}

/** The number a term carries, which is what orders 18 before "under 21". */
function numberIn(term: string): number | null {
  const found = term.match(/\d+/);
  return found ? Number(found[0]) : null;
}

/** True when every number in this term is one the product itself talks about. */
function saysNumber(term: string, productNumbers: Set<string>): boolean {
  const found = term.match(/\d+/g);
  return !found || found.every((number) => productNumbers.has(number));
}

/**
 * One problem family's evidence phrases as a Reddit search. The subject the
 * family keeps repeating becomes one clause with its singular and plural, and
 * every constraint the buyers stated - an age, a limit, a refusal - becomes a
 * second clause, so the search asks for the demand and not merely the topic.
 * A number only counts as a constraint when the product says that number too:
 * a Reddit title is full of numbers, and 4 or 17 in one of them is a room
 * count or a year, never the age this product is about. A search with no
 * subject or no constraint is not returned at all, because either half alone
 * matches most of Reddit.
 */
export function compileBooleanQuery(phrases: string[], productNumbers: Set<string>): string {
  const subjectsPerPhrase: string[][] = [];
  const constraintsPerPhrase: string[][] = [];
  for (const phrase of phrases) {
    const all = words(phrase);
    const multi = multiWordConstraints(all);
    const consumed = new Set(multi.flatMap((pair) => pair.split(" ")));
    const constraints = [
      ...multi.filter((pair) => saysNumber(pair, productNumbers)).map((pair) => `"${pair}"`),
      ...all.filter(
        (word) => !consumed.has(word) && isNumberWord(word) && productNumbers.has(word),
      ),
    ];
    constraintsPerPhrase.push(constraints);
    subjectsPerPhrase.push(
      meaningWords(phrase).filter(
        (word) =>
          !consumed.has(word) &&
          !isNumberWord(word) &&
          !NEGATIONS.has(word) &&
          !NOT_AN_ANCHOR.has(word),
      ),
    );
  }

  const stems = new Map<string, Set<string>>();
  for (const subjects of subjectsPerPhrase) {
    for (const word of subjects) {
      const stem = stemOf(word);
      stems.set(stem, (stems.get(stem) ?? new Set()).add(word));
    }
  }
  const stemCounts = countByPhrase(subjectsPerPhrase.map((list) => list.map(stemOf)));
  const bestStem = [...stems.keys()].sort(
    (left, right) => (stemCounts.get(right) ?? 0) - (stemCounts.get(left) ?? 0) || left.localeCompare(right),
  )[0];

  const constraints = [...countByPhrase(constraintsPerPhrase).keys()];
  const numbers = constraints
    .filter((term) => numberIn(term) !== null)
    .sort((left, right) => (numberIn(left) ?? 0) - (numberIn(right) ?? 0) || left.localeCompare(right));
  const rest = constraints.filter((term) => numberIn(term) === null).sort();
  if (!bestStem || numbers.length + rest.length === 0) {
    return "";
  }
  return [
    orClause([...(stems.get(bestStem) ?? [])].sort()),
    orClause([...numbers, ...rest]),
  ].join(" AND ");
}

/**
 * The compiled search split into one search per constraint. Reddit answers a
 * search with a bounded listing, and a year of "hotel AND (18 OR 21 OR ...)"
 * is far more posts than that listing holds, so the posts a single constraint
 * would have surfaced are lost behind the bulk of the others. Measured on
 * 2026-09-10: the combined query walked to about 500 posts and missed nine of
 * ten known buyers; `(hotel OR hotels) AND "under 21"` alone returned 134 and
 * held all nine. A query with one constraint is returned as it is.
 */
export function constraintQueries(query: string): string[] {
  const at = query.lastIndexOf(" AND ");
  if (at === -1) {
    return [query];
  }
  const head = query.slice(0, at);
  const tail = query.slice(at + " AND ".length);
  if (!tail.startsWith("(") || !tail.endsWith(")")) {
    return [query];
  }
  return tail
    .slice(1, -1)
    .split(" OR ")
    .map((term) => `${head} AND ${term}`);
}

/**
 * A stored compiled search with the bare negations taken out of its
 * constraints, or "" when nothing else was constraining it. The compiler
 * stopped writing them on 2026-09-14, and the keywords saved before that still
 * hold them. Measured 2026-09-18 on a first sweep: `(hotel OR hotels) AND not`
 * and `AND cant` read 290 posts for no lead, where `AND "under 21"` read 150
 * for 56. A search that is not the compiled form is returned as it is.
 */
export function withoutNegations(query: string): string {
  const at = query.lastIndexOf(" AND ");
  const tail = at === -1 ? "" : query.slice(at + " AND ".length);
  if (!tail.startsWith("(") || !tail.endsWith(")")) {
    return query;
  }
  const terms = tail.slice(1, -1).split(" OR ");
  const kept = terms.filter((term) => !NEGATIONS.has(term));
  if (kept.length === terms.length) {
    return query;
  }
  return kept.length === 0 ? "" : `${query.slice(0, at)} AND ${orClause(kept)}`;
}

/** The same search asked inside one community. */
export function scopedBooleanQuery(query: string, subreddit: string): string {
  return `subreddit:${subreddit} AND ${query}`;
}

export type CompetitorRank = {
  name: string;
  role: EntityRole;
  evidence: number;
  /** The site it sells from, when the same evidence named one. */
  domain: string | null;
};

/**
 * Only a direct substitute becomes a competitor. A booking alternative, a
 * supplier and a forum are all named in the same snippets, and calling any of
 * them a competitor is how a project ends up watching its own supplier.
 *
 * The threads name domains as well as brands, whatever role each was given, so
 * a competitor called "Typeform" is paired with the typeform.com somebody else
 * in the evidence linked to. That pairing is what puts a real logo on the
 * competitor screen instead of a favicon guessed off the spelling.
 *
 * A name is counted only from a thread that was not irrelevant, and
 * `mergeCompetitors` then keeps one that no domain in the evidence belongs to
 * only once it has been called a substitute twice. The spans offered to the
 * labeller are every capitalised run in a snippet, and on 2026-09-19 that made
 * competitors of "AI", "Cheap", "Another", "Generating Backgrounds" and "DMs":
 * an acronym is never one, and a phrase one thread used is not yet one. The
 * well known rivals no longer depend on this; the page reading names those.
 */
export function competitorsFrom(labels: ThreadLabel[]): CompetitorRank[] {
  const counts = new Map<string, number>();
  const domains = new Set<string>();
  for (const label of labels) {
    for (const entity of label.entities) {
      const name = entity.name.trim();
      if (!name) {
        continue;
      }
      const host = competitorHost(name);
      if (host) {
        domains.add(host);
      }
      if (entity.role === "direct_substitute" && label.relevance !== "irrelevant") {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([name, evidence]) => ({
      name,
      role: "direct_substitute" as EntityRole,
      evidence,
      domain: matchCompetitorDomain(name, domains),
    }))
    .sort((left, right) => right.evidence - left.evidence || left.name.localeCompare(right.name));
}

/** "AI", "MCP", "DMs": capitals and at most a plural, which names a thing and not a product. */
const ACRONYM = /^[A-Z]{2,5}s?$/;

/**
 * Whether a span called a substitute is enough of a name to watch Reddit for:
 * a domain, a name the same evidence linked a domain to, or one said twice.
 */
function namesAProduct(item: CompetitorRank): boolean {
  if (item.domain) {
    return true;
  }
  return !ACRONYM.test(item.name) && item.evidence >= 2;
}

/**
 * A weekly delta labels only its own threads, so what it found is added to the
 * competitors already standing rather than replacing them.
 */
export function mergeCompetitors(
  existing: CompetitorRank[],
  found: CompetitorRank[],
): CompetitorRank[] {
  const merged = new Map<string, CompetitorRank>();
  for (const item of [...existing, ...found]) {
    const current = merged.get(item.name);
    merged.set(item.name, {
      name: item.name,
      role: item.role,
      evidence: (current?.evidence ?? 0) + item.evidence,
      // A domain already standing is kept: a delta reads a handful of threads,
      // and none of them naming the site is not news that the site changed.
      domain: current?.domain ?? item.domain,
    });
  }
  // Judged on the total, so a standing name one more thread repeats is counted
  // with what it already had and not as a stranger said once.
  return [...merged.values()].filter(namesAProduct).sort(
    (left, right) => right.evidence - left.evidence || left.name.localeCompare(right.name),
  );
}
