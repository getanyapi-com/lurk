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
 * reads. Asked only for what the page states, 70 of 79 production profiles had
 * no not-buyer and 54 no exclusion (2026-09-19); asked to infer them, 24 of 78
 * profiles came back with a limit the site contradicts. So each one is asked
 * for with the site's own words behind it, and profile.ts checks the words.
 */
describe("profile not-buyers and exclusions", () => {
  const bullet = (name: string) =>
    PROFILE_SYSTEM.split("\n").find((line) => line.startsWith(`- ${name}:`));

  it("asks for every limit with the exact words it rests on", () => {
    expect(bullet("exclusions")).toMatch(/\{ text, sourceText \}/);
    expect(bullet("notBuyers")).toMatch(/\{ text, sourceText \}/);
    expect(bullet("exclusions")).toMatch(/copied character for character/);
  });

  it("asks what a buyer must already have, and never takes silence for a limit", () => {
    expect(bullet("exclusions")).toMatch(/what a buyer must already have or be/i);
    expect(bullet("exclusions")).toMatch(/a thing no page mentions is not a limit/);
    expect(bullet("notBuyers")).toMatch(/Never someone a page of the site sells to or invites/);
  });
});
