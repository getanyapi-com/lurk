import { describe, expect, it } from "vitest";
import { assertLane } from "@/lib/x/grammar";
import {
  DIY_WORDS,
  everydayNames,
  HARNESS_WORDS,
  RIVAL_WORDS,
  STACK_MIN_FAVES,
  VENUE_FAMILIES,
  bodyOf,
  cleanTerm,
  compileDiyLane,
  compileLanes,
  compileRivalLanes,
  compileStackLane,
  filtersOf,
  lanesInputHash,
  orderLanes,
  rivalPhrases,
  rivalSeeds,
  type SeedSlots,
} from "@/lib/x/lanes";
import { isAmbiguous, normalizeEntity } from "@/lib/x/words";

/**
 * X search is literal, so code builds every lane from terms, in three
 * families: a coined rival bound to the words people leave or weigh it in
 * (a common-word rival bound only to noun phrases), the category bound to the
 * words someone building their own writes, and the job's words in a popular
 * post written in the tools people build with.
 */
describe("X rival lanes", () => {
  it("binds coined rivals to the words people leave or weigh them in, which covers every old quoted phrase", () => {
    const [lane] = compileRivalLanes(["calendly", "acuity scheduling"], "en");
    expect(lane.body).toBe(
      `(calendly OR "acuity scheduling") (${RIVAL_WORDS.map((word) => (word.includes(" ") ? `"${word}"` : word)).join(" OR ")}) lang:en -filter:retweets`,
    );
    expect(lane.terms).toEqual([["calendly", "acuity scheduling"], RIVAL_WORDS]);
    expect(lane.family).toBe("rival");
    expect(() => assertLane(`${lane.body} since_time:1790000000`)).not.toThrow();
    // "alternative to calendly" holds both calendly and alternative, so the AND finds it.
    expect(lane.terms[1]).toContain("alternative");
  });

  it("gives a common-word rival its own lane of noun-bound phrases, never a shared group or a bare name", () => {
    expect(isAmbiguous("loom")).toBe(true);
    expect(isAmbiguous("notion")).toBe(true);
    expect(isAmbiguous("tally")).toBe(true);
    expect(isAmbiguous("calendly")).toBe(false);
    expect(isAmbiguous("typeform")).toBe(false);
    const lanes = compileRivalLanes(["loom", "jam"], "en");
    expect(lanes.map((lane) => lane.body)).toEqual([
      '("alternative to loom" OR "loom alternative" OR "loom alternatives" OR "alternatives to loom") lang:en -filter:retweets',
      '("alternative to jam" OR "jam alternative" OR "jam alternatives" OR "alternatives to jam") lang:en -filter:retweets',
    ]);
    expect(rivalPhrases("loom").every((phrase) => phrase.includes("loom"))).toBe(true);
  });

  it("packs coined rivals up to the rival and length caps, each lane one the guard accepts", () => {
    const rivals = ["calendly", "acuity scheduling", "savvycal", "youcanbook.me", "doodle", "chili piper", "zcal", "tidycal"];
    const lanes = compileRivalLanes(rivals, "en");
    expect(lanes.length).toBeGreaterThan(1);
    for (const lane of lanes) {
      expect(() => assertLane(`${lane.body} since_time:1790000000`)).not.toThrow();
      expect(lane.seeds.length).toBeLessThanOrEqual(6);
    }
    expect(lanes.flatMap((lane) => lane.seeds)).toEqual(rivals.filter((rival) => !isAmbiguous(rival)));
  });

  it("isolates a rival the model calls an everyday word, and quotes a dotted name rather than sending a bare domain", () => {
    const lanes = compileRivalLanes(["calendly", "doodle", "youcanbook.me"], "en", ["Doodle"]);
    expect(lanes.map((lane) => lane.seeds)).toEqual([["calendly", "youcanbook.me"], ["doodle"]]);
    expect(lanes[0].body.startsWith('(calendly OR "youcanbook.me") (alternative OR')).toBe(true);
    expect(lanes[1].body).toBe(
      '("alternative to doodle" OR "doodle alternative" OR "doodle alternatives" OR "alternatives to doodle") lang:en -filter:retweets',
    );
  });

  it("binds rivals to switch and evaluate words, never to a cost or breakage word alone", () => {
    for (const word of ["moving away from", "switched from", "vs", "thoughts on", "is down", "cheaper"]) {
      expect(RIVAL_WORDS).toContain(word);
    }
    for (const word of ["broken", "stopped working", "unreliable", "pricing", "expensive", "overpriced"]) {
      expect(RIVAL_WORDS).not.toContain(word);
    }
  });

  it("never seeds the project's own name, drops unusable names, and keeps standing order", () => {
    expect(rivalSeeds(["Cal.com", "Calendly", "calendly", "  ", "Acuity Scheduling", "21"], ["Cal.com", "cal"])).toEqual([
      "calendly",
      "acuity scheduling",
    ]);
    expect(normalizeEntity('"Notion" (docs)')).toBe("notion docs");
    expect(normalizeEntity("a very long product name that nobody types")).toBeNull();
    expect(normalizeEntity("“Doodle”,")).toBe("doodle");
    expect(normalizeEntity("Yahoo!")).toBe("yahoo");
  });
});

describe("X build-vs-buy and workflow lanes", () => {
  const calcom: SeedSlots = {
    artifacts: ["scheduling tool", "booking page", "tool", "Cal.com", "Calendly clone"],
    topics: ["round robin", "booking link", "scheduling", "app", "calendly"],
    ordinaryWordRivals: ["Doodle"],
    notProducts: [],
  };

  it("binds coined rivals and the category's nouns to the words someone building their own writes", () => {
    const lane = compileDiyLane(calcom, ["calendly", "doodle", "savvycal"], ["Cal.com", "cal"], "en");
    expect(lane?.family).toBe("diy");
    // The everyday-word rival, a lone generic word, the product's own name and a term naming a rival are left out.
    expect(lane?.terms[0]).toEqual(["calendly", "scheduling tool", "savvycal", "booking page"]);
    expect(lane?.label).toBe("Building their own scheduling tool, or replacing calendly, savvycal");
    expect(lane?.terms[1]).toEqual(DIY_WORDS);
    expect(lane?.seeds).toEqual(["calendly", "savvycal"]);
    expect(lane?.body.endsWith(" lang:en -filter:retweets")).toBe(true);
    expect(() => assertLane(`${lane?.body} since_time:1790000000`)).not.toThrow();
  });

  it("keeps room for the category's nouns beside many rivals, and never trims the fixed words to fit", () => {
    const rivals = ["apify", "bright data", "ensembledata", "firecrawl", "hikerapi", "oxylabs", "proxycurl", "rapidapi", "zenrows"];
    const long = ["scraping api platform", "social data api", "instagram scraper tool", "tiktok data provider", "serp api service", "profile enrichment api", "lead data provider", "web scraping service"];
    const lane = compileDiyLane({ artifacts: long, topics: [] }, rivals, [], "en");
    expect(lane?.terms[1]).toEqual(DIY_WORDS);
    expect(lane?.terms[0].some((term) => long.includes(term))).toBe(true);
    expect(lane?.seeds.every((rival) => lane.terms[0].includes(rival))).toBe(true);
    // The label names only words the query holds.
    const labelled = lane!.label.match(/their own ([^,]+),/u)?.[1];
    expect(lane?.terms[0]).toContain(labelled);
    const stack = compileStackLane({ artifacts: [], topics: long }, [], [], "en");
    expect(stack?.terms[0]).toEqual(HARNESS_WORDS);
    expect(stack!.body.length).toBeLessThanOrEqual(380);
  });

  it("keeps both the rivals and the nouns when the query must be trimmed to fit", () => {
    const artifacts = ["scheduling tool", "scheduling tools", "booking page", "booking pages", "booking link", "calendar booking tool"];
    const lane = compileDiyLane({ artifacts, topics: [] }, ["calendly", "savvycal", "acuity scheduling"], [], "en");
    expect(lane?.terms[0]).toContain("calendly");
    expect(lane?.terms[0]).toContain("scheduling tool");
    expect(lane!.body.length).toBeLessThanOrEqual(380);
  });

  it("leaves the product's own tools and its rivals out of the workflow lane's harness", () => {
    const lane = compileStackLane(calcom, ["zapier", "make"], ["n8n"], "en");
    expect(lane?.terms[0]).not.toContain("zapier");
    expect(lane?.terms[0]).not.toContain("make.com");
    expect(lane?.terms[0]).not.toContain("n8n");
    expect(lane?.terms[0]).toContain("claude code");
  });

  it("keeps a dotted name coined whatever the model called it", () => {
    expect([...everydayNames(["Doodle", "context.dev", "Otterly.AI", "Chaser"])].sort()).toEqual(["chaser", "doodle"]);
    const lanes = compileRivalLanes(["apify", "context.dev"], "en", ["context.dev"]);
    expect(lanes.map((one) => one.seeds)).toEqual([["apify", "context.dev"]]);
  });

  it("labels a lane with no rivals, and a workflow lane, in words that read", () => {
    expect(compileDiyLane({ artifacts: ["form builder", "form builders"], topics: [] }, [], [], "en")?.label).toBe(
      "Building or replacing their own form builder, form builders",
    );
    expect(compileStackLane({ artifacts: [], topics: ["scraping", "scrape", "scraper", "scrapers", "tiktok data"] }, [], [], "en")?.label).toBe(
      "Popular posts on how people do scraping, tiktok data",
    );
  });

  it("makes a build-vs-buy lane from rivals alone, or from nouns alone, and none from neither", () => {
    expect(compileDiyLane(null, ["calendly"], [], "en")?.terms[0]).toEqual(["calendly"]);
    expect(compileDiyLane({ artifacts: ["scheduling tool", "booking page"], topics: [] }, [], [], "en")?.terms[0]).toEqual([
      "scheduling tool",
      "booking page",
    ]);
    expect(compileDiyLane({ artifacts: ["app"], topics: [] }, ["loom"], [], "en")).toBeNull();
  });

  it("binds the job's words to the tools people build with, top-level posts with reach only", () => {
    const lane = compileStackLane(calcom, ["calendly"], ["Cal.com"], "en");
    expect(lane?.family).toBe("stack");
    expect(lane?.terms).toEqual([HARNESS_WORDS, ["round robin", "booking link", "scheduling"]]);
    expect(lane?.body.endsWith(` lang:en -filter:retweets -filter:replies min_faves:${STACK_MIN_FAVES}`)).toBe(true);
    expect(filtersOf(lane!.body)).toEqual({ topLevelOnly: true, minFaves: STACK_MIN_FAVES });
    expect(() => assertLane(`${lane?.body} since_time:1790000000`)).not.toThrow();
  });

  it("makes no workflow lane without topics: the tools alone are every developer on X", () => {
    expect(compileStackLane({ ...calcom, topics: ["app", "tool"] }, [], [], "en")).toBeNull();
    expect(compileStackLane(null, ["calendly"], [], "en")).toBeNull();
  });

  it("reads venue families as the ones whose posts can be worth a reply without an ask", () => {
    expect(VENUE_FAMILIES.has("diy")).toBe(true);
    expect(VENUE_FAMILIES.has("stack")).toBe(true);
    expect(VENUE_FAMILIES.has("rival")).toBe(false);
  });

  it("trims the largest group until the lane fits, so a long slot still makes a lane", () => {
    const topics = Array.from({ length: 8 }, (_, index) => `topic${index} long phrase`);
    const lane = compileStackLane({ artifacts: [], topics }, [], [], "en");
    expect(lane?.body.length).toBeLessThanOrEqual(380);
    expect(() => assertLane(lane!.body)).not.toThrow();
  });

  it("cleans a term into something a lane can hold, or refuses it", () => {
    expect(cleanTerm('  "Google  Maps" ')).toBe("google maps");
    expect(cleanTerm("context.dev")).toBe("context.dev");
    expect(cleanTerm("x")).toBeNull();
    expect(cleanTerm("1000")).toBeNull();
    expect(cleanTerm("or")).toBeNull();
    expect(cleanTerm("back and forth")).toBe("back and forth");
    expect(cleanTerm("client won’t pay")).toBe("client won't pay");
    expect(cleanTerm("one two three four five")).toBeNull();
    expect(cleanTerm("from:someone")).toBe("from someone");
  });
});

describe("X lane order and inputs", () => {
  it("puts the first rival lane, build-vs-buy and workflow first, so a three-lane plan gets one of each", () => {
    const slots: SeedSlots = { artifacts: ["scraping api"], topics: ["scraping", "scraper"] };
    const rivals = ["apify", "bright data", "firecrawl", "oxylabs", "proxycurl", "rapidapi", "scraperapi", "loom"];
    const lanes = compileLanes({ rivals, slots, ownNames: ["AnyAPI"], lang: "en" });
    expect(lanes.slice(0, 3).map((lane) => lane.family)).toEqual(["rival", "diy", "stack"]);
    expect(lanes.slice(3).every((lane) => lane.family === "rival")).toBe(true);
    expect(orderLanes([], null, null)).toEqual([]);
    expect(compileLanes({ rivals: [], slots: null, ownNames: [], lang: "en" })).toEqual([]);
  });

  it("writes a single-alternative group bare, a phrase quoted, and the filters in the tail's order", () => {
    expect(bodyOf([["firecrawl"], ["expensive", "ran out"]], "en")).toBe('firecrawl (expensive OR "ran out") lang:en -filter:retweets');
    expect(bodyOf([["n8n"]], "en", { topLevelOnly: true, minFaves: 20 })).toBe("n8n lang:en -filter:retweets -filter:replies min_faves:20");
  });

  it("changes the input hash when the rivals, the seed words, the own names or the language change", () => {
    const base = lanesInputHash(["calendly"], "en");
    expect(lanesInputHash(["calendly"], "en")).toBe(base);
    expect(lanesInputHash(["calendly", "doodle"], "en")).not.toBe(base);
    expect(lanesInputHash(["calendly"], "es")).not.toBe(base);
    expect(lanesInputHash(["calendly"], "en", { artifacts: ["booking page"], topics: [] })).not.toBe(base);
    expect(lanesInputHash(["calendly"], "en", null, ["Cal.com"])).not.toBe(base);
  });
});
