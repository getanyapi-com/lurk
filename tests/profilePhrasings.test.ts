import { describe, expect, it } from "vitest";
import { pageCompetitors, platformPhrasings } from "@/lib/profile";

/**
 * The searches for the platforms a page names are built, not asked for, so the
 * same page always produces the same ones. Both forms are asked: Google's
 * volume is on "<platform> api", and the same person on Reddit says scraper.
 */
describe("the searches built from a product's platforms", () => {
  it("asks for each platform both ways a buyer types it", () => {
    expect(platformPhrasings(["LinkedIn", "Google Maps"], true)).toEqual([
      "linkedin api",
      "linkedin scraper",
      "google maps api",
      "google maps scraper",
    ]);
  });

  it("says the same thing once, however the page said it", () => {
    expect(platformPhrasings(["Reddit", " reddit ", "REDDIT"], true)).toEqual([
      "reddit api",
      "reddit scraper",
    ]);
  });

  it("buys nothing for an empty name, and nothing for no platforms", () => {
    expect(platformPhrasings(["", "   "], true)).toEqual([]);
    expect(platformPhrasings([], true)).toEqual([]);
  });

  it("buys none for a product that only works with those platforms", () => {
    // yarooms.com books meeting rooms and connects to Microsoft 365. Nobody
    // searching "outlook add-in scraper" is looking for it.
    expect(platformPhrasings(["Microsoft Teams", "Outlook add-in"], false)).toEqual([]);
  });
});

describe("the competitors a page reading names", () => {
  it("keeps each name once, never the product itself, and a domain only when it is one", () => {
    expect(
      pageCompetitors("YAROOMS", [
        { name: " Robin ", domain: "https://robinpowered.com/pricing" },
        { name: "robin", domain: "" },
        { name: "Yarooms", domain: "yarooms.com" },
        { name: "Envoy", domain: "not sure" },
        { name: "", domain: "skedda.com" },
      ]),
    ).toEqual([
      { name: "Robin", domain: "robinpowered.com" },
      { name: "Envoy", domain: null },
    ]);
  });

  it("stops at five", () => {
    const named = ["A", "B", "C", "D", "E", "F", "G"].map((name) => ({ name: `Tool ${name}`, domain: "" }));
    expect(pageCompetitors("Mine", named)).toHaveLength(5);
  });
});
