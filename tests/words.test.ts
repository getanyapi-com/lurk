import { describe, expect, it } from "vitest";
import { FIT } from "@/lib/scan/derive";
import { INTENT_LEVELS } from "@/lib/scan/questions";
import { fitWord, intentWord, judgementSentence } from "@/lib/scan/words";

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

  it("says nothing at all about a level nothing judged", () => {
    expect(fitWord(null)).toBeNull();
    expect(intentWord(null)).toBeNull();
    expect(judgementSentence(null, null)).toBeNull();
  });

  it("keeps the rubric's own sentences for the detail view", () => {
    expect(judgementSentence(4, 3)).toBe(`${FIT[4]}. ${INTENT_LEVELS[3]}.`);
  });

  it("never reads as a percent of anything", () => {
    const fold = [4, 3, 2, 1, 0].flatMap((fit) =>
      [4, 3, 2, 1, 0].map((intent) => `${fitWord(fit)} / ${intentWord(intent)}`),
    );
    expect(fold.some((words) => /\d/.test(words))).toBe(false);
  });
});
