import { describe, expect, it } from "vitest";
import { buildStream, type CardLead } from "@/components/leads/stream";
import { entryHref, heldEntryId, requestedEntry, selectEntry } from "@/components/leads/workspace";
import type { ReviewItem } from "@/lib/feed";

/**
 * The workspace always has something in its right pane. It opens on the row the
 * URL names, and when that row is not in the list any more - a filter moved, a
 * lead was hidden - it falls back rather than blanking.
 */
function card(id: string): CardLead {
  return {
    id,
    score: 70,
    fit: 3,
    intent: 2,
    engagement: 1,
    stage: "solution_seeking",
    kind: "buyer",
    reason: "They asked for a recommendation.",
    matchedPhrase: null,
    title: id,
    url: `https://reddit.test/${id}`,
    subreddit: "hotels",
    subredditIconUrl: null,
    subredditWeeklyActive: null,
    promoPolicy: null,
    rulesText: null,
    imageUrl: null,
    numComments: 0,
    points: 0,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    body: "",
    author: "asker",
    avatarUrl: null,
    authorKarma: null,
    authorCreatedAt: null,
    isComment: false,
    postAuthor: "asker",
    postAuthorAvatar: null,
  };
}

function heldItem(id: string): ReviewItem {
  return {
    id,
    title: id,
    subreddit: "hotels",
    url: `https://reddit.test/${id}`,
    author: "unsure",
    avatarUrl: null,
    authorKarma: null,
    authorCreatedAt: null,
    subredditIconUrl: null,
    numComments: 0,
    points: 0,
    isComment: false,
    reason: "The evidence did not settle it.",
    reasonCodes: ["insufficient_evidence"],
    fit: 2,
    intent: 1,
    needState: "open",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    judgedAt: new Date("2026-09-02T00:00:00Z"),
  };
}

describe("selectEntry", () => {
  const entries = buildStream([card("first"), card("second")]);
  const held = [heldItem("held-one"), heldItem("held-two")];

  it("opens the lead the URL asked for", () => {
    const selection = selectEntry(entries, held, entries[1].id);

    expect(selection).toEqual({ kind: "lead", entry: entries[1] });
  });

  it("opens the held candidate the URL asked for", () => {
    const selection = selectEntry(entries, held, heldEntryId(held[1]));

    expect(selection).toEqual({ kind: "held", item: held[1] });
  });

  it("falls back to the best lead when the asked-for row is not in this list", () => {
    expect(selectEntry(entries, held, "lead-gone")).toEqual({ kind: "lead", entry: entries[0] });
    expect(selectEntry(entries, held, undefined)).toEqual({ kind: "lead", entry: entries[0] });
  });

  it("falls back to the first held candidate when there are no leads", () => {
    expect(selectEntry([], held, "lead-gone")).toEqual({ kind: "held", item: held[0] });
  });

  it("has nothing to open when there are neither", () => {
    expect(selectEntry([], [], "lead-gone")).toBeNull();
  });
});

describe("requestedEntry", () => {
  const entries = buildStream([card("first"), card("second")]);
  const held = [heldItem("held-one")];

  /**
   * The list holds one page of the feed. A row this page does not have is not
   * a row that is gone: saying so is what lets the page read that one lead
   * instead of opening the pane on the best one and losing the click.
   */
  it("says nothing when the asked-for row is not in this list", () => {
    expect(requestedEntry(entries, held, "lead-fortieth")).toBeNull();
    expect(requestedEntry(entries, held, undefined)).toBeNull();
  });

  it("finds the row when this list is holding it", () => {
    expect(requestedEntry(entries, held, entries[1].id)).toEqual({ kind: "lead", entry: entries[1] });
    expect(requestedEntry(entries, held, heldEntryId(held[0]))).toEqual({ kind: "held", item: held[0] });
  });
});

describe("entryHref", () => {
  it("keeps the filters the row was found under", () => {
    const href = entryHref({ days: "7", subreddit: "hotels", stage: undefined, lead: "lead-old" }, "lead-new");

    expect(href).toBe("?days=7&subreddit=hotels&lead=lead-new");
  });
});
