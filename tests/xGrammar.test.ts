import { describe, expect, it } from "vitest";
import { XLaneRefusedError, assertLane } from "@/lib/x/grammar";

/**
 * The X lane grammar: lurk's check refuses everything but the shapes the lane
 * compiler writes, before a billed call.
 */
describe("assertLane", () => {
  const good = '("alternative to calendly" OR "calendly alternative") lang:en -filter:retweets since_time:1790000000';

  it("accepts the shapes the compiler writes, with or without the tail", () => {
    expect(() => assertLane(good)).not.toThrow();
    expect(() => assertLane('("alternative to calendly" OR "calendly alternative")')).not.toThrow();
    expect(() => assertLane('("alternative to calendly") lang:en -filter:retweets')).not.toThrow();
    expect(() => assertLane('"x api" (expensive OR cost OR pricing OR bankrupt) lang:en -filter:retweets')).not.toThrow();
    expect(() => assertLane('(calendly OR "acuity scheduling") (alternative OR pricing) lang:en -filter:retweets')).not.toThrow();
    expect(() => assertLane('("x api" OR "reddit api") (profiles OR posts) (scrape OR scraping) lang:en')).not.toThrow();
    expect(() => assertLane('firecrawl (expensive OR "ran out") lang:en -filter:retweets since_time:1790000000')).not.toThrow();
    expect(() => assertLane('"scraper keeps breaking" lang:en -filter:retweets')).not.toThrow();
    expect(() => assertLane('("context.dev" OR "youcanbook.me") (alternative OR pricing)')).not.toThrow();
    // A workflow lane: top-level posts with a like floor.
    expect(() =>
      assertLane('("claude code" OR n8n) (scraping OR scraper) lang:en -filter:retweets -filter:replies min_faves:20 since_time:1790000000'),
    ).not.toThrow();
    expect(() => assertLane('("alternative to calendly") min_faves:5')).not.toThrow();
  });

  it.each([
    ['("alternative to calendly" or "calendly alternative") lang:en', "lowercase or"],
    ['("alternative to calendly" AND "calendly alternative")', "AND keyword"],
    ['("alternative to calendly" OR NOT "calendly alternative")', "NOT keyword"],
    ['subreddit:hotels ("check in")', "subreddit operator"],
    ['("alternative to calendly") to:calendly', "to: operator"],
    ['("alternative to calendly") min_faves:0', "a zero like floor"],
    ['("alternative to calendly") min_faves:5 -filter:replies', "filters out of order"],
    ['min_faves:5 ("alternative to calendly")', "a filter before the words"],
    ['"alternative to calendly" OR "calendly alternative" lang:en', "top-level OR without a group"],
    ['("alternative to calendly" OR calendly alternative)', "bare-word alternative"],
    ['("alternative to calendly OR "calendly alternative")', "unbalanced quotes"],
    ['(("alternative to calendly"))', "nested groups"],
    ['("alternative to calendly" OR "not")', "a negation as an alternative"],
    ['("alternative to calendly" OR "21")', "a bare number as an alternative"],
    ['("i really need a new scheduling tool for my team")', "a sentence as a phrase"],
    ['("alternative to calendly") lang:en since_time:1790000000 -filter:retweets', "tail out of order"],
    ['"x api" expensive OR cost lang:en', "an OR outside a group"],
    ["(a OR b) (c OR d) (e OR f) (g OR h)", "more than three groups"],
    ["-(spam OR scam) (alternative OR pricing)", "a negated group"],
    ["-winklink (alternative OR pricing)", "a negated word"],
    ["(alternative OR pricing) OR", "a dangling OR"],
    ["(alternative OR pricing) lang:en -filter:links", "an operator lurk does not send"],
    ["(alternative OR pricing) lang:en from:calendly", "a from: operator"],
    ["(context.dev OR youcanbook.me) (alternative OR pricing)", "a bare dotted name"],
    // Measured on X (AnyAPI threads 94b6f435, 93af4985, aa29340d, 329e92c8):
    // word soup, and operators X bound to the last OR alternative only.
    ["(company enrichment OR people enrichment OR work email) since_time:1786752000", "word-soup alternatives"],
    ['Jev OR "TypeSafe AI" OR typesafe.ai -filter:replies', "an operator bound to one alternative"],
    ["help OR support -filter:replies lang:en", "operators bound to one alternative"],
    ['scraping OR "scraping API" since_time:1787189936 lang:en', "operators bound to one alternative"],
    ["alternative OR alternatives (Apify OR Firecrawl OR ScraperAPI OR ScrapingBee) since_time:1787189936 lang:en", "a top-level OR beside a group"],
    ["(Jev OR typesafe.ai -filter:replies) filter:videos", "an operator inside a group"],
  ])("refuses %s (%s)", (query) => {
    expect(() => assertLane(query)).toThrow(XLaneRefusedError);
  });

  it("refuses a query over the length cap", () => {
    const phrases = Array.from({ length: 30 }, (_, i) => `"alternative to product${i}"`).join(" OR ");
    expect(() => assertLane(`(${phrases})`)).toThrow(/longer than/);
  });
});
