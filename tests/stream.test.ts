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

    const { columns, grain, live } = timeline([face("today", 0), face("older", 5)], { days: 7 }, now);

    expect(grain).toBe("day");
    expect(columns).toHaveLength(7);
    expect(columns.at(-1)?.faces.map((one) => one.id)).toEqual(["today"]);
    expect(columns.at(-1)?.key).toBe("2026-09-17");
    expect(columns.at(-6)?.faces.map((one) => one.id)).toEqual(["older"]);
    // The quiet days between the two keep their room rather than closing up.
    expect(columns.filter((column) => column.faces.length === 0)).toHaveLength(5);
    expect(live).toBe(true);
  });

  it("drops a step when a slice is picked: a day into hours, a month into days", () => {
    const now = new Date(2026, 8, 17, 15, 30).getTime();
    const face = (id: string, at: Date, score = 70): LeadFace => ({
      id,
      at,
      score,
      author: "asker",
      avatarUrl: null,
      subreddit: "hotels",
    });
    const morning = face("morning", new Date(2026, 8, 14, 9, 10));
    const best = face("best", new Date(2026, 8, 14, 9, 40), 95);
    const night = face("night", new Date(2026, 8, 14, 22, 5));

    const day = timeline([morning, best, night], { days: 30, at: "2026-09-14" }, now);

    expect(day.grain).toBe("hour");
    expect(day.columns).toHaveLength(24);
    expect(day.columns[9].faces.map((one) => one.id)).toEqual(["best", "morning"]);
    expect(day.columns[9].key).toBe("2026-09-14T09");
    expect(day.columns[22].faces.map((one) => one.id)).toEqual(["night"]);
    // A day already gone by has no "now" on it to colour.
    expect(day.live).toBe(false);

    // An hour picked still reads its own day, so the neighbouring hours are
    // there to move to and the one picked is there to click off again.
    const hour = timeline([morning, best, night], { days: 30, at: "2026-09-14T09" }, now);
    expect(hour.grain).toBe("hour");
    expect(hour.columns[9].key).toBe("2026-09-14T09");

    const month = timeline([morning, best, night], { days: 30, at: "2026-09" }, now);
    expect(month.grain).toBe("day");
    // September, all thirty days of it, whatever window it was picked from.
    expect(month.columns).toHaveLength(30);
    expect(month.columns[13].key).toBe("2026-09-14");
    expect(month.columns[13].faces).toHaveLength(3);
  });

  it("reads a long backfill in months, and a short one still in days", () => {
    const now = new Date(2026, 8, 17, 15, 30).getTime();
    const face = (id: string, daysAgo: number): LeadFace => ({
      id,
      at: new Date(now - daysAgo * DAY_MS),
      score: 70,
      author: "asker",
      avatarUrl: null,
      subreddit: "hotels",
    });

    const long = timeline([face("old", 300), face("new", 0)], { days: "all" }, now);

    expect(long.grain).toBe("month");
    expect(long.columns.at(-1)?.key).toBe("2026-09");
    expect(long.columns.at(-1)?.faces.map((one) => one.id)).toEqual(["new"]);
    expect(long.columns[0].faces.map((one) => one.id)).toEqual(["old"]);
    // Eleven months, one column each: a year of leads still fits the card.
    expect(long.columns.length).toBeLessThanOrEqual(31);

    const short = timeline([face("old", 20), face("new", 0)], { days: "all" }, now);
    expect(short.grain).toBe("day");
    expect(short.columns.at(-1)?.key).toBe("2026-09-17");
  });

  it("labels the axis often enough to read, and thins it for a narrow card", () => {
    const now = new Date(2026, 8, 17, 15, 30).getTime();
    const faces: LeadFace[] = [
      { id: "one", at: new Date(now), score: 70, author: "a", avatarUrl: null, subreddit: "h" },
    ];

    const { columns, ticks } = timeline(faces, { days: 30 }, now);

    expect(columns).toHaveLength(30);
    // Both ends always, and enough between them to find a date by reading
    // rather than by counting columns.
    expect(ticks.length).toBeGreaterThanOrEqual(7);
    expect(ticks[0].index).toBe(0);
    expect(ticks.at(-1)?.index).toBe(29);
    expect(ticks[0].sparse).toBe(true);
    expect(ticks.at(-1)?.sparse).toBe(true);
    // The narrow set is a subset of the wide one, so a small card never labels
    // a column a big one leaves bare.
    expect(ticks.filter((tick) => tick.sparse).length).toBeLessThan(ticks.length);
  });
});
