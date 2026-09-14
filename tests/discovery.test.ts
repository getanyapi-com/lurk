import { describe, expect, it, vi } from "vitest";
import { keepCitedLabels, labelThreads, type ThreadLabel } from "@/lib/discovery/label";
import { planFromRanks } from "@/lib/discovery/plan";
import { numberTerms, stripRedditSuffix } from "@/lib/discovery/phrases";
import {
  buildDiscoveryQueries,
  expandDiscoveryQueries,
  expansionShouldStop,
  type Destination,
} from "@/lib/discovery/queries";
import {
  compileBooleanQuery,
  constraintQueries,
  competitorsFrom,
  coverageFrom,
  dedupeThreads,
  isDestinationQuery,
  mergeCompetitors,
  rankCommunities,
  rankFamilies,
  scopedBooleanQuery,
  type EvidenceLike,
} from "@/lib/discovery/rank";
import { askedQueries } from "@/lib/discovery/refresh";
import { googleQuery } from "@/lib/seo/fetch";
import { TIERS } from "@/lib/tiers";

const generateStructured = vi.fn();
vi.mock("@/lib/llm", () => ({ generateStructured: (...args: unknown[]) => generateStructured(...args) }));

/**
 * HotelsAllow is the project the plan is proved against: a site that lists
 * hotels which check in guests under 21, in a handful of American cities. Its
 * eight opening queries and the threads they return are the fixture, because
 * every decision here - which community, which search, which competitor - is
 * only worth anything if it survives this one real product.
 */

/** Phrasings as the profile prompt now asks for them: short and searchable. */
const PHRASINGS = [
  "hotels that allow 18 year olds",
  "under 21 hotel check in",
  "hotel refused check in because of age",
  "minimum hotel check in age",
];

const DESTINATIONS: Destination[] = [
  { name: "Las Vegas", sourceText: "Hotels in Las Vegas" },
  { name: "Miami, Florida", sourceText: "Hotels in Miami, Florida" },
  { name: "New York", sourceText: "Hotels in New York" },
  { name: "Chicago", sourceText: "Hotels in Chicago" },
];

const DESTINATION_NAMES = DESTINATIONS.map((place) => place.name);

/** The ages this product itself talks about, which is what makes one a term. */
const PRODUCT_NUMBERS = numberTerms([
  ...PHRASINGS,
  "Lists hotels that check in guests aged 18, 19 and 20 without a 21 rule",
]);

describe("the queries discovery buys", () => {
  const queries = buildDiscoveryQueries({
    problemPhrasings: PHRASINGS,
    destinations: DESTINATIONS,
    budget: TIERS.free.discoveryQueries,
  });

  it("splits the budget between the problem and the places the page names", () => {
    expect(queries).toHaveLength(8);
    expect(queries.filter((item) => item.destination === null)).toHaveLength(4);
    expect(queries.filter((item) => item.destination !== null)).toHaveLength(4);
    expect(queries.every((item) => item.query.endsWith(" reddit"))).toBe(true);
  });

  /**
   * A shared Google run is keyed on the query text alone, so discovery and the
   * Reddit SEO tab asking one phrasing two ways bought it twice. They ask the
   * one question now, and the second caller pays nothing.
   */
  it("asks Google the same question the Reddit SEO tab asks", () => {
    const asked = buildDiscoveryQueries({
      problemPhrasings: PHRASINGS,
      destinations: [],
      budget: 1,
    });
    expect(asked[0].query).toBe(googleQuery(PHRASINGS[0]));
  });

  it("asks the phrasing as the buyer said it, word for word", () => {
    expect(queries[0].query).toBe(googleQuery("hotels that allow 18 year olds"));
    expect(queries[1].query).toBe(googleQuery("under 21 hotel check in"));
    expect(queries[2].query).toBe(googleQuery("hotel refused check in because of age"));
  });

  it("adds the city, and only the city, to a query about a place", () => {
    const placed = queries.filter((item) => item.destination !== null);
    expect(placed.map((item) => item.destination)).toEqual(DESTINATION_NAMES);
    expect(placed[0].query).toBe(googleQuery("hotels that allow 18 year olds Las Vegas"));
    expect(placed[1].query).toBe(googleQuery("under 21 hotel check in Miami"));
    expect(placed[1].query).not.toContain("Florida");
  });

  it("spends the whole budget on the problem when the page names no place", () => {
    const noPlace = buildDiscoveryQueries({
      problemPhrasings: PHRASINGS,
      destinations: [],
      budget: TIERS.free.discoveryQueries,
    });
    expect(noPlace).toHaveLength(PHRASINGS.length);
    expect(noPlace.every((item) => item.destination === null)).toBe(true);
  });

  it("asks nothing at all when the page gave it no phrasing", () => {
    expect(
      buildDiscoveryQueries({ problemPhrasings: [], destinations: DESTINATIONS, budget: 8 }),
    ).toEqual([]);
  });
});

describe("expanding into what produced nothing", () => {
  const used = buildDiscoveryQueries({
    problemPhrasings: PHRASINGS,
    destinations: DESTINATIONS,
    budget: TIERS.free.discoveryQueries,
  });

  /** Every family answered except the third, and only Las Vegas proven. */
  const coverage = {
    families: { "hotels-allow-18": 4, "under-21-hotel": 2, "minimum-hotel-check": 1 },
    destinations: { "Las Vegas": 3 },
  };

  const round = expandDiscoveryQueries({
    problemPhrasings: PHRASINGS,
    destinations: DESTINATIONS,
    budget: TIERS.free.discoveryQueries,
    used,
    coverage,
    max: TIERS.free.discoveryQueriesMax,
  });

  it("buys the family with no evidence first, against the place that worked", () => {
    expect(round[0].family).toBe("hotel-refused-check");
    expect(round[0].destination).toBe("Las Vegas");
  });

  it("then takes the places in the order the page named them", () => {
    expect(round.slice(1).map((item) => item.destination)).toEqual([
      "Miami, Florida",
      "New York",
      "Chicago",
    ]);
  });

  it("rotates the phrasings instead of asking one sentence in every city", () => {
    const families = round.slice(1).map((item) => item.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it("leaves the rest of the cities to the weekly refresh", () => {
    const many = expandDiscoveryQueries({
      problemPhrasings: PHRASINGS,
      destinations: [
        ...DESTINATIONS,
        ...["Orlando", "Austin", "San Diego", "Honolulu", "Myrtle Beach", "Berkeley"].map(
          (name) => ({ name, sourceText: `Hotels in ${name}` }),
        ),
      ],
      budget: TIERS.free.discoveryQueries,
      used,
      coverage,
      max: 100,
    });
    expect(many).toHaveLength(PHRASINGS.length);
    expect(many.some((item) => item.destination === "Honolulu")).toBe(false);
  });

  it("never spends past the tier's hard maximum", () => {
    const room = expandDiscoveryQueries({
      problemPhrasings: PHRASINGS,
      destinations: DESTINATIONS,
      budget: TIERS.free.discoveryQueries,
      used: [...used, ...round.slice(0, 3)],
      coverage,
      max: TIERS.free.discoveryQueriesMax,
    });
    expect(room).toHaveLength(1);
  });

  it("proposes nothing once every place and family has evidence", () => {
    expect(
      expandDiscoveryQueries({
        problemPhrasings: PHRASINGS,
        destinations: DESTINATIONS,
        budget: 8,
        used,
        coverage: {
          families: Object.fromEntries(
            used.map((item) => [item.family, 1]),
          ),
          destinations: Object.fromEntries(DESTINATION_NAMES.map((name) => [name, 1])),
        },
        max: 100,
      }),
    ).toEqual([]);
  });

  it("gives up after two rounds that each found under two new relevant threads", () => {
    expect(expansionShouldStop([])).toBe(false);
    expect(expansionShouldStop([0])).toBe(false);
    expect(expansionShouldStop([5, 1])).toBe(false);
    expect(expansionShouldStop([1, 0])).toBe(true);
    expect(expansionShouldStop([0, 0, 4])).toBe(false);
  });
});

describe("labels the model has to cite", () => {
  const label = (id: string): ThreadLabel => ({
    id,
    relevance: "relevant",
    destination: null,
    entities: [],
  });

  it("drops a label about a thread we never showed it", () => {
    const kept = keepCitedLabels([label("a1"), label("invented"), label("a2")], ["a1", "a2"]);
    expect(kept.map((item) => item.id)).toEqual(["a1", "a2"]);
  });

  it("keeps the first answer when one thread was labelled twice", () => {
    const kept = keepCitedLabels(
      [label("a1"), { ...label("a1"), relevance: "irrelevant" }],
      ["a1"],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].relevance).toBe("relevant");
  });

  it("asks again for the threads the model left out", async () => {
    generateStructured.mockReset();
    generateStructured.mockResolvedValueOnce({
      results: [{ id: "a1", relevance: "relevant", destination: null, entities: [] }],
    });
    generateStructured.mockResolvedValueOnce({
      results: [{ id: "a2", relevance: "plausible", destination: null, entities: [] }],
    });
    const labels = await labelThreads({
      projectId: "p1",
      productText: "Product: HotelsAllow",
      candidates: ["a1", "a2", "a3"].map((id) => ({
        id,
        subreddit: "hotels",
        title: `Thread ${id}`,
        snippet: "",
      })),
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(String(generateStructured.mock.calls[1][0].prompt)).toContain("id: a3");
    expect(labels.map((item) => item.id)).toEqual(["a1", "a2"]);
  });
});

/** The threads the eight queries came back with, as Google ordered them. */
const BROAD = googleQuery("hotels that allow 18 year olds");
const BROAD_TWO = googleQuery("minimum hotel check in age");
const VEGAS = googleQuery("hotels that allow 18 year olds Las Vegas");
const MIAMI = googleQuery("under 21 hotel check in Miami");

const EVIDENCE: EvidenceLike[] = [
  {
    postId: "t1",
    subreddit: "hotels",
    query: BROAD,
    family: "hotels-allow-18",
    destination: null,
    position: 1,
    title: "Hotels that let 18 year olds check in : r/hotels",
    snippet: "I turn 19 next month and need a room.",
    relevance: "relevant",
  },
  {
    postId: "t2",
    subreddit: "hotels",
    query: BROAD_TWO,
    family: "minimum-hotel-check",
    destination: null,
    position: 2,
    title: "Hotel under 21 check in - Reddit",
    snippet: "Front desk turned me away for being 20.",
    relevance: "relevant",
  },
  {
    postId: "t3",
    subreddit: "askhotels",
    query: BROAD,
    family: "hotels-allow-18",
    destination: null,
    position: 3,
    title: "Hotels for 19 year olds : r/askhotels - Reddit",
    snippet: "Anywhere that will check me in at 19?",
    relevance: "relevant",
  },
  {
    postId: "t4",
    subreddit: "travel",
    query: BROAD,
    family: "hotels-allow-18",
    destination: null,
    position: 4,
    title: "Travelling at 20, hotels keep refusing",
    snippet: "Every desk wants 21.",
    relevance: "plausible",
  },
  {
    postId: "t5",
    subreddit: "TravelHacks",
    query: BROAD_TWO,
    family: "minimum-hotel-check",
    destination: null,
    position: 8,
    title: "Cheapest way to fly standby",
    snippet: "Nothing to do with hotels.",
    relevance: "irrelevant",
  },
  {
    postId: "t6",
    subreddit: "vegas",
    query: VEGAS,
    family: "hotels-allow-18",
    destination: "Las Vegas",
    position: 1,
    title: "Hotels 20 year olds Las Vegas",
    snippet: "Which strip hotels check in under 21? hotelages.com says four.",
    relevance: "relevant",
  },
  {
    postId: "t7",
    subreddit: "vegas",
    query: VEGAS,
    family: "hotels-allow-18",
    destination: "Las Vegas",
    position: 5,
    title: "Best buffet on the strip",
    snippet: "Food, not rooms.",
    relevance: "irrelevant",
  },
  {
    postId: "t8",
    subreddit: "askmiami",
    query: MIAMI,
    family: "under-21-hotel",
    destination: "Miami, Florida",
    position: 2,
    title: "Hotels that let 19 year olds check in Miami : r/askmiami",
    snippet: "Staying alone at 19.",
    relevance: "relevant",
  },
  {
    postId: "t1",
    subreddit: "hotels",
    query: VEGAS,
    family: "hotels-allow-18",
    destination: "Las Vegas",
    position: 6,
    title: "Hotels that let 18 year olds check in : r/hotels",
    snippet: "I turn 19 next month and need a room.",
    relevance: "relevant",
  },
];

describe("what the evidence says about communities", () => {
  it("counts one thread once however many queries returned it", () => {
    const threads = dedupeThreads(EVIDENCE);
    expect(threads).toHaveLength(8);
    const shared = threads.find((thread) => thread.postId === "t1");
    expect(shared?.bestPosition).toBe(1);
    expect(shared?.destinations).toEqual(["Las Vegas"]);
  });

  it("cuts Google's own suffix off a title before anything reads it", () => {
    expect(stripRedditSuffix("Hotels for 19 year olds : r/askhotels - Reddit")).toBe(
      "Hotels for 19 year olds",
    );
    expect(stripRedditSuffix("Hotel under 21 check in | Reddit")).toBe("Hotel under 21 check in");
    expect(stripRedditSuffix("Best buffet on the strip")).toBe("Best buffet on the strip");
    const threads = dedupeThreads(EVIDENCE);
    expect(threads.find((thread) => thread.postId === "t3")?.title).toBe(
      "Hotels for 19 year olds",
    );
  });

  it("tells a query about a place from a query about the problem, by its city", () => {
    expect(isDestinationQuery(VEGAS, DESTINATION_NAMES)).toBe(true);
    expect(isDestinationQuery(MIAMI, DESTINATION_NAMES)).toBe(true);
    expect(isDestinationQuery(BROAD, DESTINATION_NAMES)).toBe(false);
  });

  it("puts the communities the problem is discussed in first", () => {
    const ranked = rankCommunities(EVIDENCE, DESTINATION_NAMES);
    expect(ranked[0].name).toBe("hotels");
    expect(ranked.map((item) => item.name)).toContain("askhotels");
    expect(ranked.find((item) => item.name === "hotels")?.families).toBe(2);
  });

  it("reaches a city community the broad queries would have buried", () => {
    const ranked = rankCommunities(EVIDENCE, DESTINATION_NAMES).map((item) => item.name);
    expect(ranked[1]).toBe("askmiami");
    expect(ranked.indexOf("vegas")).toBeLessThan(ranked.indexOf("travelhacks"));
  });

  it("gives a community whose only threads were irrelevant no weight at all", () => {
    const ranked = rankCommunities(EVIDENCE, DESTINATION_NAMES);
    expect(ranked.find((item) => item.name === "travelhacks")?.weighted).toBe(0);
  });

  it("smooths the relevant share, so one hit does not beat a proven community", () => {
    const ranked = rankCommunities(EVIDENCE, DESTINATION_NAMES);
    const vegas = ranked.find((item) => item.name === "vegas");
    expect(vegas?.weighted).toBe(1);
    expect(vegas?.fraction).toBe(0.5);
  });

  it("reads coverage off the same evidence expansion is judged on", () => {
    const coverage = coverageFrom(EVIDENCE);
    expect(coverage.families["hotels-allow-18"]).toBe(4);
    expect(coverage.destinations["Las Vegas"]).toBe(2);
  });
});

describe("what the evidence says to search for", () => {
  it("collapses the city out of a phrase so one demand is one family", () => {
    const families = rankFamilies(EVIDENCE, DESTINATION_NAMES, PHRASINGS);
    const top = families[0];
    expect(top.family).toBe("hotels-allow-18");
    expect(top.phrases).toContain("hotels 20 year olds");
    expect(top.phrases.every((phrase) => !phrase.includes("reddit"))).toBe(true);
    const miami = families.find((family) => family.family === "under-21-hotel");
    expect(miami?.phrases).toContain("hotels that let 19 year olds check in");
  });

  it("compiles a family into a Reddit search for the demand, not the topic", () => {
    expect(
      compileBooleanQuery(
        [
          "hotels that let 18 year olds check in",
          "hotels for 19 year olds",
          "hotel under 21 check in",
          "hotels 20 year olds",
        ],
        PRODUCT_NUMBERS,
      ),
    ).toBe('(hotel OR hotels) AND (18 OR 19 OR 20 OR "under 21" OR "check in")');
  });

  it("splits a compiled search into one search per constraint, scoped or not", () => {
    expect(constraintQueries('(hotel OR hotels) AND (18 OR "under 21" OR "check in")')).toEqual([
      "(hotel OR hotels) AND 18",
      '(hotel OR hotels) AND "under 21"',
      '(hotel OR hotels) AND "check in"',
    ]);
    expect(constraintQueries('subreddit:vegas AND (hotel OR hotels) AND (18 OR "under 21")')).toEqual([
      "subreddit:vegas AND (hotel OR hotels) AND 18",
      'subreddit:vegas AND (hotel OR hotels) AND "under 21"',
    ]);
    expect(constraintQueries('(hotel OR hotels) AND "under 21"')).toEqual(['(hotel OR hotels) AND "under 21"']);
    expect(constraintQueries("hotels that allow 18 year olds")).toEqual(["hotels that allow 18 year olds"]);
  });

  it("keeps only the numbers the product itself talks about", () => {
    expect(PRODUCT_NUMBERS).toEqual(new Set(["18", "21", "19", "20"]));
    expect(
      compileBooleanQuery(
        ["hotel with 4 beds at 17", "hotels that let 18 year olds check in"],
        PRODUCT_NUMBERS,
      ),
    ).toBe('(hotel OR hotels) AND (18 OR "check in")');
  });

  it("never anchors the search on a word every Reddit title carries", () => {
    expect(
      compileBooleanQuery(["reddit hotels 18 check in", "reddit hotel help 19"], PRODUCT_NUMBERS),
    ).toBe('(hotel OR hotels) AND (18 OR 19 OR "check in")');
  });

  it("returns nothing at all without both a subject and a constraint", () => {
    expect(compileBooleanQuery(["hotels near the strip"], PRODUCT_NUMBERS)).toBe("");
    expect(compileBooleanQuery(["18 or 19"], PRODUCT_NUMBERS)).toBe("");
  });

  it("scopes the same search to one community", () => {
    expect(scopedBooleanQuery("(hotel OR hotels)", "vegas")).toBe(
      "subreddit:vegas AND (hotel OR hotels)",
    );
  });
});

describe("competitors", () => {
  const labels: ThreadLabel[] = [
    {
      id: "t6",
      relevance: "relevant",
      destination: "Las Vegas",
      entities: [
        { name: "hotelages.com", role: "direct_substitute" },
        { name: "Booking.com", role: "booking_alternative" },
        { name: "Hilton", role: "supplier" },
        { name: "r/vegas", role: "reference" },
      ],
    },
    {
      id: "t8",
      relevance: "relevant",
      destination: "Miami, Florida",
      entities: [{ name: "hotelages.com", role: "direct_substitute" }],
    },
  ];

  it("keeps only what does the same job for the same person", () => {
    expect(competitorsFrom(labels)).toEqual([
      { name: "hotelages.com", role: "direct_substitute", evidence: 2 },
    ]);
  });

  it("adds a delta's evidence to what already stood", () => {
    expect(
      mergeCompetitors(
        [{ name: "hotelages.com", role: "direct_substitute", evidence: 2 }],
        competitorsFrom(labels),
      ),
    ).toEqual([{ name: "hotelages.com", role: "direct_substitute", evidence: 4 }]);
  });
});

describe("the plan the ranking publishes", () => {
  const plan = planFromRanks({
    communities: rankCommunities(EVIDENCE, DESTINATION_NAMES),
    families: rankFamilies(EVIDENCE, DESTINATION_NAMES, PHRASINGS),
    competitors: [{ name: "hotelages.com", role: "direct_substitute", evidence: 2 }],
    scopedCommunities: ["vegas"],
    productNumbers: PRODUCT_NUMBERS,
    limits: { ...TIERS.free, subredditsPerProject: 3 },
  });

  it("gives no community without evidence a row of any kind", () => {
    expect(plan.subreddits.map((row) => row.name)).not.toContain("travelhacks");
  });

  it("polls only a community two threads have proved, and keeps the rest waiting", () => {
    expect(plan.subreddits.filter((row) => row.state === "active").map((row) => row.name)).toEqual([
      "hotels",
    ]);
    expect(plan.subreddits.find((row) => row.name === "askhotels")?.state).toBe("candidate");
    expect(plan.subreddits.find((row) => row.name === "vegas")?.state).toBe("candidate");
  });

  it("stops at the tier's community limit even when more have earned it", () => {
    const crowded = planFromRanks({
      communities: [
        { name: "hotels", weighted: 4, families: 2, fraction: 0.8, bestPosition: 1, threads: 4 },
        { name: "askhotels", weighted: 3, families: 1, fraction: 0.7, bestPosition: 2, threads: 3 },
        { name: "travel", weighted: 2, families: 1, fraction: 0.6, bestPosition: 3, threads: 2 },
      ],
      families: [],
      competitors: [],
      scopedCommunities: [],
      productNumbers: PRODUCT_NUMBERS,
      limits: { ...TIERS.free, subredditsPerProject: 2 },
    });
    expect(crowded.subreddits.map((row) => row.state)).toEqual([
      "active",
      "active",
      "candidate",
    ]);
  });

  it("keeps one row per search when two families compile to the same one", () => {
    const twice = planFromRanks({
      communities: [],
      families: [
        {
          family: "a",
          weighted: 4,
          phrases: ["hotels that let 18 year olds check in", "hotel 18 check in"],
          asked: null,
        },
        {
          family: "b",
          weighted: 2,
          phrases: ["hotel 18 check in", "hotels that let 18 year olds check in"],
          asked: null,
        },
      ],
      competitors: [],
      scopedCommunities: [],
      productNumbers: PRODUCT_NUMBERS,
      limits: TIERS.free,
    });
    expect(twice.keywords).toEqual([
      { keyword: '(hotel OR hotels) AND (18 OR "check in")', evidence: 4 },
    ]);
  });

  /**
   * A product whose buyers ask for the thing by its name has no age, no limit
   * and no refusal to compile, so every family returned an empty query and the
   * project got no searches at all. Measured 2026-09-13 against getanyapi.com:
   * the five phrasings the profile produced compiled to nothing, and the live
   * project on lurk.so had 0 of 25 searches. These titles are the ones Google
   * returned that day for "reddit scraper api".
   */
  it("falls back to the phrasing itself when a family carries no constraint", () => {
    const nouns = planFromRanks({
      communities: [],
      families: [
        {
          family: "reddit-scraper-api",
          weighted: 3,
          phrases: [
            "How to scrape Reddit now (Closed API)?",
            "Open-source Reddit scraper",
            "Best Methods for Scraping Reddit Data?",
          ],
          asked: "reddit scraper api",
        },
      ],
      competitors: [],
      scopedCommunities: [],
      productNumbers: new Set<string>(),
      limits: TIERS.free,
    });
    expect(nouns.keywords).toEqual([{ keyword: "reddit scraper api", evidence: 3 }]);
  });

  /**
   * Two phrasings share a family key when their first three meaning words
   * match, so the key alone cannot say which of them Google answered. Reading
   * the fallback off the key picked whichever phrasing the product listed last
   * and threw the supported one away. The phrasing is taken from the query
   * behind the evidence instead, so this goes through the real ranking.
   */
  it("falls back to the phrasing the evidence came from, not a colliding one", () => {
    const phrasings = ["reddit scraper api comments", "reddit scraper api images"];
    const collided: EvidenceLike[] = [
      {
        postId: "c1",
        subreddit: "webscraping",
        query: googleQuery("reddit scraper api comments"),
        family: "reddit-scraper-api",
        destination: null,
        position: 1,
        title: "Open source Reddit comment scraper",
        snippet: "I need every comment on a thread.",
        relevance: "relevant",
      },
    ];
    const colliding = planFromRanks({
      communities: [],
      families: rankFamilies(collided, [], phrasings),
      competitors: [],
      scopedCommunities: [],
      productNumbers: new Set<string>(),
      limits: TIERS.free,
    });
    expect(colliding.keywords).toEqual([
      { keyword: "reddit scraper api comments", evidence: 1 },
    ]);
  });

  /**
   * Reddit search matches words where Google reads meaning, so a phrasing long
   * enough to be a sentence matches most of the site. Measured 2026-09-14:
   * "another provider means another schema again" returns Schema Therapy, and
   * "need data without another subscription" returns phone data plans. Nothing
   * is lost by leaving it out - Google still asks it in discovery and in the
   * Reddit SEO tab.
   */
  it("does not hand Reddit search a phrasing long enough to be a sentence", () => {
    const sentence = planFromRanks({
      communities: [],
      families: rankFamilies(
        [
          {
            postId: "s1",
            subreddit: "dataengineering",
            query: googleQuery("another provider means another schema again"),
            family: "another-provider-means",
            destination: null,
            position: 1,
            title: "How do you handle schema changes when downstream consumers expect stability?",
            snippet: "Every provider has its own shape.",
            relevance: "relevant",
          },
        ],
        [],
        ["another provider means another schema again"],
      ),
      competitors: [],
      scopedCommunities: [],
      productNumbers: new Set<string>(),
      limits: TIERS.free,
    });
    expect(sentence.keywords).toEqual([]);
  });

  /**
   * A refusal word is not a constraint. `(api) AND (without)` asks for every
   * post about an API, and on lurk.so on 2026-09-14 that search and its two
   * siblings produced 0, 0 and 1 leads against 7 for "instagram api".
   */
  it("writes no search when the only constraint the evidence carries is a refusal", () => {
    const refusal = planFromRanks({
      communities: [],
      families: [
        {
          family: "pay-per-request",
          weighted: 2,
          phrases: ["an api without a monthly plan", "api without subscription"],
          asked: null,
        },
      ],
      competitors: [],
      scopedCommunities: [],
      productNumbers: new Set<string>(),
      limits: TIERS.free,
    });
    expect(refusal.keywords).toEqual([]);
  });

  /** A stated number the product itself talks about is still a constraint. */
  it("keeps a compiled search when the constraint is a number the product says", () => {
    const compiled = planFromRanks({
      communities: [],
      families: [
        {
          family: "hotels-allow-18",
          weighted: 4,
          phrases: ["hotels that let 18 year olds check in", "hotel 18 check in"],
          asked: null,
        },
      ],
      competitors: [],
      scopedCommunities: [],
      productNumbers: PRODUCT_NUMBERS,
      limits: TIERS.free,
    });
    expect(compiled.keywords).toEqual([
      { keyword: '(hotel OR hotels) AND (18 OR "check in")', evidence: 4 },
    ]);
  });

  /** A family nothing asked for still has no search to fall back to. */
  it("writes no search for a family whose phrasing it never saw", () => {
    const orphan = planFromRanks({
      communities: [],
      families: [
        { family: "unasked-family", weighted: 2, phrases: ["open source reddit scraper"], asked: null },
      ],
      competitors: [],
      scopedCommunities: [],
      productNumbers: new Set<string>(),
      limits: TIERS.free,
    });
    expect(orphan.keywords).toEqual([]);
  });

  it("searches the compiled families and the discovered city community", () => {
    expect(plan.keywords.some((row) => row.keyword.startsWith("subreddit:vegas AND "))).toBe(true);
    expect(plan.keywords.every((row) => row.evidence > 0)).toBe(true);
    expect(plan.keywords.every((row) => row.keyword.includes(" AND "))).toBe(true);
  });
});

describe("reading back what a project has already asked", () => {
  it("recognises a place query by the place in it, not by a stored flag", () => {
    const asked = askedQueries(EVIDENCE, DESTINATION_NAMES);
    expect(asked).toHaveLength(4);
    expect(asked.find((item) => item.query === VEGAS)?.destination).toBe("Las Vegas");
    expect(asked.find((item) => item.query === MIAMI)?.destination).toBe("Miami, Florida");
    expect(asked.find((item) => item.query === BROAD)?.destination).toBeNull();
  });
});
