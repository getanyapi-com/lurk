import { describe, expect, it } from "vitest";
import { FIT, INTENT_LEVELS } from "@/lib/scan/questions";
import { fitWord, intentWord, judgementSentence, rankWord } from "@/lib/scan/words";

/**
 * The feed used to print the folded score as a percent. A fifth of that fold is
 * a freshness clock, so a thread the product fully fits where someone is
 * explicitly asking reads 70 once it is three days old, and 70 reads as "there
 * is nothing good in here". The card says the two answers instead, so every
 * level the rubric can answer has to have a word.
 */
describe("the words a card says instead of a percent", () => {
  it("has a word for every level the rubric can answer", () => {
    for (const level of Object.keys(FIT).map(Number)) {
      expect(fitWord(level)).toBeTruthy();
    }
    for (let level = 0; level < INTENT_LEVELS.length; level += 1) {
      expect(intentWord(level)).toBeTruthy();
    }
  });

  it("calls an explicit ask the product fits exactly a strong lead", () => {
    expect(rankWord(4, 3)).toBe("Strong lead");
    expect(rankWord(3, 4)).toBe("Strong lead");
    expect(rankWord(3, 3)).toBe("Good lead");
    expect(rankWord(4, 2)).toBe("Worth a look");
    expect(rankWord(null, 3)).toBeNull();
  });

  it("says nothing at all about a level nothing judged", () => {
    expect(fitWord(null)).toBeNull();
    expect(intentWord(null)).toBeNull();
    expect(judgementSentence(null, null)).toBeNull();
  });

  it("keeps the rubric's own sentences for the detail view, one labelled line each", () => {
    expect(judgementSentence(4, 3)).toBe(
      `Where they are: an explicit ask for a product, tool, service or provider to use: a recommendation, a replacement or a comparison.\n` +
        `Whether you fit: ${FIT[4]}.`,
    );
  });

  it("labels a single answer when only one was judged", () => {
    expect(judgementSentence(2, null)).toBe(`Whether you fit: ${FIT[2]}.`);
    expect(judgementSentence(null, 0)).toBe("Where they are: no need of their own.");
  });

  it("never reads as a percent of anything", () => {
    const fold = [4, 3, 2, 1, 0].flatMap((fit) =>
      [4, 3, 2, 1, 0].map((intent) => `${intentWord(intent)} ${fitWord(fit)}`),
    );
    expect(fold.some((words) => /\d/.test(words))).toBe(false);
  });

  /**
   * The complaint that started this: "Fits fully / Asking" named neither the
   * product nor the person, so a reader had to know the rubric to read it.
   */
  it("names its own subject in every word, so no word is a bare adjective", () => {
    for (const level of Object.keys(FIT).map(Number)) {
      expect(fitWord(level)).toMatch(/your/i);
    }
    for (let level = 0; level < INTENT_LEVELS.length; level += 1) {
      expect(intentWord(level)!.split(" ").length).toBeGreaterThan(1);
    }
  });
});
