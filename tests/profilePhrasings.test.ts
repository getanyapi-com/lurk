import { describe, expect, it } from "vitest";
import { platformPhrasings } from "@/lib/profile";

/**
 * The searches for the platforms a page names are built, not asked for, so the
 * same page always produces the same ones. Both forms are asked: Google's
 * volume is on "<platform> api", and the same person on Reddit says scraper.
 */
describe("the searches built from a product's platforms", () => {
  it("asks for each platform both ways a buyer types it", () => {
    expect(platformPhrasings(["LinkedIn", "Google Maps"])).toEqual([
      "linkedin api",
      "linkedin scraper",
      "google maps api",
      "google maps scraper",
    ]);
  });

  it("says the same thing once, however the page said it", () => {
    expect(platformPhrasings(["Reddit", " reddit ", "REDDIT"])).toEqual([
      "reddit api",
      "reddit scraper",
    ]);
  });

  it("buys nothing for an empty name, and nothing for no platforms", () => {
    expect(platformPhrasings(["", "   "])).toEqual([]);
    expect(platformPhrasings([])).toEqual([]);
  });
});
