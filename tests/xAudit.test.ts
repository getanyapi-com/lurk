import { describe, expect, it } from "vitest";
import {
  MAX_PROBE_TERMS,
  compileProbeLanes,
  grams,
  lossKey,
  lossOf,
  probeTerms,
  samplePosts,
  termLift,
  textMatches,
} from "@/lib/x/audit";
import { assertLane } from "@/lib/x/grammar";

describe("probeTerms", () => {
  it("takes one from rivals, platforms, artifacts and topics in turn, once each", () => {
    const terms = probeTerms({
      rivals: ["calendly", "doodle", "savvycal"],
      slots: { artifacts: ["booking page", "Booking Page"], topics: ["round robin"], ordinaryWordRivals: ["Doodle"], notProducts: [] },
      phrasings: ["calendar api", "I need a booking link"],
    });
    expect(terms).toEqual(["calendly", "calendar api", "booking page", "round robin", "savvycal"]);
  });

  it("leaves out rows the seed call said name no product, and caps the list without starving the slots", () => {
    const rivals = Array.from({ length: 30 }, (_, index) => `rival${index}`);
    const terms = probeTerms({
      rivals: ["this", ...rivals],
      slots: { artifacts: ["booking page"], topics: ["round robin"], notProducts: ["this"] },
      phrasings: [],
    });
    expect(terms).not.toContain("this");
    expect(terms).toHaveLength(MAX_PROBE_TERMS);
    expect(terms).toContain("booking page");
    expect(terms).toContain("round robin");
  });
});

describe("post-unit sampling", () => {
  it("keeps every shown post even when conversation/author would have been duplicated", () => {
    const samples = samplePosts([
      { id: "1", stages: ["lead", "free_rejected"], conversation: "same", author: "a" },
      { id: "2", stages: ["reply"], conversation: "same", author: "a" },
      { id: "3", stages: ["rejected"], conversation: "same", author: "a" },
      { id: "4", stages: ["free_rejected"], conversation: "same", author: "a" },
    ], "frozen", 1, 1);
    expect(samples.map((sample) => [sample.stratum, sample.population, sample.selected.length, sample.weight])).toEqual([
      ["shown", 2, 2, 1], ["judged", 1, 1, 1], ["screened", 1, 1, 1],
    ]);
  });

  it("does not make screened eligibility depend on rejected sample size", () => {
    const posts = Array.from({ length: 12 }, (_, index) => ({ id: String(index), stages: [index < 6 ? "rejected" : "free_rejected"] }));
    const small = samplePosts(posts, "frozen", 1, 2);
    const large = samplePosts(posts, "frozen", 5, 2);
    expect(small[2]).toEqual(large[2]);
    expect(small[1].weight).toBe(6);
    expect(small[2].weight).toBe(3);
    expect(samplePosts(posts, "frozen", 1, 2)).toEqual(small);
  });

  it("records zero-budget strata as unsampled, never as zero loss", () => {
    expect(samplePosts([{ id: "1", stages: ["free_rejected"] }], "frozen", 0, 0)[2]).toMatchObject({ population: 1, selected: [], weight: null });
    expect(() => samplePosts([{ id: "1", stages: [] }], "frozen", 1, 1)).toThrow();
    expect(() => samplePosts([{ id: "1", stages: ["lead"] }, { id: "1", stages: ["lead"] }], "frozen", 1, 1)).toThrow();
    expect(() => samplePosts([], "frozen", -1, 1)).toThrow();
  });
});

describe("compileProbeLanes", () => {
  it("writes each term alone and with asking words, every body one X accepts", () => {
    const lanes = compileProbeLanes(["x api", "scraping"]);
    expect(lanes.map((lane) => lane.label)).toEqual(["probe: x api", "probe: x api + ask", "probe: scraping", "probe: scraping + ask"]);
    expect(lanes[0].body).toBe('"x api" lang:en -filter:retweets');
    for (const lane of lanes) expect(() => assertLane(lane.body)).not.toThrow();
  });
});

describe("textMatches", () => {
  it("needs one alternative of every group at a word start anywhere in the post", () => {
    const terms = [["x api", "twitter api"], ["cheaper", "alternative"]];
    expect(textMatches("What's the best way to pull tweets cheaper than the official X-API?", terms)).toBe(true);
    expect(textMatches("X API is so expensive", terms)).toBe(false);
    expect(textMatches("the max api is cheaper", terms)).toBe(false);
  });
});

describe("lossOf", () => {
  const lanes = [{ label: "rivals", terms: [["apify"], ["alternative"]] }];

  it("tells a search that cannot reach a post from one whose page did not hold it", () => {
    expect(lossOf({ fetched: false }, "any alternative to apify?", lanes)).toEqual({ at: "not_reached", lanes: ["rivals"] });
    expect(lossOf({ fetched: false }, "x api is too expensive", lanes)).toEqual({ at: "not_reachable" });
  });

  it("names the screen rule, the judge reason, or a post still waiting", () => {
    const fate = (stage: string, freeReject: string | null = null, reasonCode: string | null = null) =>
      ({ fetched: true, stage, freeReject, reasonCode, laneLabel: null }) as const;
    expect(lossKey(lossOf(fate("free_rejected", "listicle"), "", lanes))).toBe("screened:listicle");
    expect(lossKey(lossOf(fate("rejected", null, "no_active_need"), "", lanes))).toBe("judged_out:no_active_need");
    expect(lossKey(lossOf(fate("lead"), "", lanes))).toBe("shown");
    expect(lossKey(lossOf(fate("reply"), "", lanes))).toBe("shown");
    expect(lossKey(lossOf(fate("pending_context"), "", lanes))).toBe("unfinished:pending_context");
  });
});

describe("termLift", () => {
  it("counts a term once per author, so one person repeating it is no winner", () => {
    const posts = [
      { text: "x api is too expensive", author: "a", gold: "ask" as const },
      { text: "x api is too expensive, again", author: "a", gold: "ask" as const },
      { text: "the x api pricing hurts", author: "b", gold: "ask" as const },
      { text: "too expensive dinner", author: "c", gold: "not" as const },
      { text: "my dinner", author: "d", gold: "not" as const },
    ];
    const lifts = termLift(posts);
    const xApi = lifts.find((lift) => lift.gram === "x api");
    expect(xApi).toMatchObject({ positives: 2, negatives: 0 });
    expect(lifts.find((lift) => lift.gram === "too expensive")).toBeUndefined();
    expect(lifts[0].gram).toBe("x api");
  });

  it("reads words and pairs without links, handles or stop-word pairs", () => {
    const found = grams("@bob the X API https://t.co/abc is down");
    expect(found.has("x api")).toBe(true);
    expect(found.has("bob")).toBe(false);
    expect([...found].some((gram) => gram.includes("t co"))).toBe(false);
    expect(found.has("the")).toBe(false);
  });
});
