import { describe, expect, it } from "vitest";
import { PROFILE_SYSTEM } from "@/lib/prompts";

describe("profile phrasings", () => {
  it("asks for phrasings spread across the situations the page implies", () => {
    const bullet = PROFILE_SYSTEM.split("\n").find((line) => line.startsWith("- problemPhrasings:"));
    expect(bullet).toBeDefined();
    expect(bullet).toMatch(/distinct situations/);
    expect(bullet).toMatch(/who is acting for whom/);
    expect(bullet).toMatch(/booking already made/);
    expect(bullet).toMatch(/"parent booking a hotel for an 18 year old"/);
  });

  /**
   * A product whose buyers ask for the thing by name had no way to say so: the
   * prompt asked only for a problem with a constraint in it, and forbade every
   * product and company name, so "reddit scraper" could never be written down.
   * Measured 2026-09-13, getanyapi.com produced "no plan for one endpoint job",
   * whose Google results are IT career threads, while "reddit scraper api"
   * returns people asking for one.
   *
   * The names are now their own field. Asked for as phrasings they came back
   * 25, 5 and 25 times over three runs of one unchanged page on 2026-09-16, so
   * a platform the page names had no search bought for it at all; asked for as
   * platforms the same three runs named the same 31, and the searches are built
   * from them in code.
   */
  it("asks for the platforms by name, and forbids them in the phrasings", () => {
    const platforms = PROFILE_SYSTEM.split("\n").find((line) => line.startsWith("- platforms:"));
    expect(platforms).toMatch(/every system, platform, site or kind of data/);
    expect(platforms).toMatch(/the words a buyer types for the thing itself/);
    expect(platforms).toMatch(/this product's own name and the names of its rivals/);
    expect(platforms).toMatch(/a rival is not a platform/);

    const bullet = PROFILE_SYSTEM.split("\n").find((line) => line.startsWith("- problemPhrasings:"));
    expect(bullet).toMatch(/Do not write the name a buyer types for a platform here/);
  });

  /** A phrase with its small words taken out is a keyword list, not a search. */
  it("asks for the phrasing a person says out loud, not a bag of keywords", () => {
    const bullet = PROFILE_SYSTEM.split("\n").find((line) => line.startsWith("- problemPhrasings:"));
    expect(bullet).toMatch(/rather than as a bag of keywords/);
    expect(bullet).toMatch(/keep the small words that make it a sentence/);
  });
});

/**
 * The profile only ever described who the buyer is, so a person who shares the
 * product's vocabulary and will never buy had no way into the facts the judge
 * reads. The page is still the only source, so the field is allowed to be empty.
 */
describe("profile not-buyers", () => {
  it("asks who is not a buyer, only where the page supports it", () => {
    const bullet = PROFILE_SYSTEM.split("\n").find((line) => line.startsWith("- notBuyers:"));
    expect(bullet).toBeDefined();
    expect(bullet).toMatch(/not its buyer/);
    expect(bullet).toMatch(/Empty list when the page gives no ground/);
  });
});
