import { describe, expect, it } from "vitest";
import { buildStream, timeline, type CardLead } from "@/components/leads/stream";
import type { LeadFace } from "@/lib/feed";

/**
 * The feed opens on the best lead, not the newest thing found. Sorting the
 * stream by date on top of the query's score order threw fit and intent away,
 * and on 2026-09-10 put two crossposts of one person recruiting festival
 * companions above every real buyer.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function card(id: string, score: number, ageDays: number): CardLead {
  return {
    id,
    postId: `post-${id}`,
    score,
    fit: 3,
    intent: 2,
    engagement: 1,
    stage: "solution_seeking",
    kind: "buyer",
    reason: "",
    matchedPhrase: "",
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
    createdAt: new Date(Date.now() - ageDays * DAY_MS),
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

describe("the lead stream", () => {
  it("keeps the feed query's order, so the weakest lead never opens it", () => {
    // As listLeads returns them: score first, then the newer need.
    const entries = buildStream([card("strong", 75, 20), card("weak", 55, 1)]);

    expect(entries.map((entry) => entry.lead.id)).toEqual(["strong", "weak"]);
  });

  it("draws a window of days in days, so a column is a day you can click", () => {
    const now = new Date(2026, 8, 17, 15, 30).getTime();
    const face = (id: string, daysAgo: number): LeadFace => ({
      id,
      at: new Date(now - daysAgo * DAY_MS),
      score: 70,
      author: "asker",
      avatarUrl: null,
      subreddit: "hotels",
    });

    const { columns, live } = timeline([face("today", 0), face("older", 5)], { days: 7 }, now);

    expect(columns).toHaveLength(7);
    expect(columns.at(-1)?.faces.map((one) => one.id)).toEqual(["today"]);
    expect(columns.at(-1)?.day).toBe("2026-09-17");
    expect(columns.at(-6)?.faces.map((one) => one.id)).toEqual(["older"]);
    // The quiet days between the two keep their room rather than closing up.
    expect(columns.filter((column) => column.faces.length === 0)).toHaveLength(5);
    expect(live).toBe(true);
  });

  it("lays one day out in hours, and those are not days to click", () => {
    const now = new Date(2026, 8, 17, 15, 30).getTime();
    const at = (hour: number): Date => new Date(2026, 8, 14, hour, 10);
    const face = (id: string, hour: number, score = 70): LeadFace => ({
      id,
      at: at(hour),
      score,
      author: "asker",
      avatarUrl: null,
      subreddit: "hotels",
    });

    const { columns, ticks, live } = timeline(
      [face("morning", 9), face("best", 9, 95), face("night", 22)],
      { days: 30, day: "2026-09-14" },
      now,
    );

    expect(columns).toHaveLength(24);
    expect(columns[9].faces.map((one) => one.id)).toEqual(["best", "morning"]);
    expect(columns[22].faces.map((one) => one.id)).toEqual(["night"]);
    expect(columns.every((column) => column.day === null)).toBe(true);
    // A day already gone by has no "now" on it to colour.
    expect(live).toBe(false);
    expect(ticks.at(0)?.index).toBe(0);
    expect(ticks.at(-1)?.index).toBe(23);
  });

  it("draws all time in whole days, from the oldest lead to today", () => {
    const now = new Date(2026, 8, 17, 15, 30).getTime();
    const face = (id: string, daysAgo: number): LeadFace => ({
      id,
      at: new Date(now - daysAgo * DAY_MS),
      score: 70,
      author: "asker",
      avatarUrl: null,
      subreddit: "hotels",
    });

    const { columns } = timeline([face("old", 300), face("new", 0)], { days: "all" }, now);

    // A year of backfill still fits the card: thirty columns at most, and the
    // oldest lead is inside the first of them. A column is a fortnight there,
    // so it is not one day and not a day the feed can be filtered to.
    expect(columns.length).toBeLessThanOrEqual(30);
    expect(columns[0].faces.map((one) => one.id)).toEqual(["old"]);
    expect(columns.at(-1)?.faces.map((one) => one.id)).toEqual(["new"]);
    expect(columns.at(-1)?.day).toBeNull();
  });
});
