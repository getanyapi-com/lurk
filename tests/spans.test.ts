import { describe, expect, it } from "vitest";
import { itemState, spans } from "@/lib/scan/spans";

/**
 * The sentences the model is offered to quote from. It can only pick one of
 * these, so what is in here is exactly what a lead card can ever say, and a
 * Choice takes at most 255 options.
 */

describe("cutting a candidate into sentences", () => {
  it("puts the title first and then the body, at sentence ends and line breaks", () => {
    expect(spans("Need a form tool", "Ours cannot branch.\nIt has to take payments.")).toEqual({
      s0: "Need a form tool",
      s1: "Ours cannot branch.",
      s2: "It has to take payments.",
    });
  });

  it("merges neighbours until a long post fits what one Choice can offer", () => {
    const body = Array.from({ length: 900 }, (_, index) => `Sentence ${index}.`).join(" ");
    const cut = spans("A long one", body);
    const ids = Object.keys(cut);
    // 254 options plus the `none` the quote question always offers is 255.
    expect(ids.length).toBeLessThanOrEqual(254);
    expect(ids.length).toBeGreaterThan(1);
    expect(cut.s0).toContain("A long one");
    const joined = Object.values(cut).join(" ");
    expect(joined).toContain("Sentence 0.");
    expect(joined).toContain("Sentence 1.");
  });

  it("offers a commenter only their own words, and the parent post as one block", () => {
    const state = itemState({
      id: "c1",
      title: "Need a form tool",
      subreddit: "SaaS",
      body: "Same here.",
      author: "someone",
      ageHours: 2,
      upvotes: 1,
      numComments: 3,
      parentBody: "Ours cannot branch and it has to take payments.",
    });
    expect(Object.values(state.sentences as Record<string, string>)).toEqual([
      "Need a form tool",
      "Same here.",
    ]);
    expect(state.parent_post_replied_to).toBe("Ours cannot branch and it has to take payments.");
  });
});
