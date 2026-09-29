import { describe, expect, it } from "vitest";
import { FIRST_LOOK_HOURS } from "@/lib/x/constants";
import { quietFrom } from "@/lib/x/quiet";
import { freshness, reachScore, replyWindowOpen } from "@/lib/x/reach";
import { VENUE_SYSTEM, venueVerdict } from "@/lib/x/reply";

/**
 * What the X tab needs to show posts worth a reply where nobody is shopping:
 * how much a reply now would be seen, the venue check's verdict decided in
 * code, and when X is quiet enough for a product to say so.
 */

const NOW = new Date("2026-09-28T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe("reach", () => {
  it("scores views on a log scale times what is left of the reply window", () => {
    expect(reachScore({ likeCount: 0, viewCount: 100_000, createdAt: hoursAgo(1) }, NOW)).toBe(100);
    expect(reachScore({ likeCount: 0, viewCount: 10_000, createdAt: hoursAgo(1) }, NOW)).toBe(80);
    expect(reachScore({ likeCount: 0, viewCount: 10_000, createdAt: hoursAgo(20) }, NOW)).toBe(36);
    // No views from X: a guess from its likes.
    expect(reachScore({ likeCount: 100, viewCount: null, createdAt: hoursAgo(1) }, NOW)).toBe(80);
    expect(reachScore({ likeCount: null, viewCount: null, createdAt: hoursAgo(1) }, NOW)).toBe(0);
  });

  it("carries a post seen early forward at the rate it drew views then, up to eightfold", () => {
    const createdAt = hoursAgo(4);
    const seenEarly = reachScore({ likeCount: 0, viewCount: 500, createdAt, fetchedAt: hoursAgo(3.5) }, NOW);
    const seenLate = reachScore({ likeCount: 0, viewCount: 500, createdAt, fetchedAt: hoursAgo(0) }, NOW);
    expect(seenEarly).toBeGreaterThan(seenLate);
    expect(seenEarly).toBe(reachScore({ likeCount: 0, viewCount: 4_000, createdAt }, NOW));
  });

  it("keeps the reply window open for five hours, then fades it over two days", () => {
    expect(replyWindowOpen(hoursAgo(4.9), NOW)).toBe(true);
    expect(replyWindowOpen(hoursAgo(5.1), NOW)).toBe(false);
    expect([1, 8, 20, 40, 80].map((hours) => freshness(hoursAgo(hours), NOW))).toEqual([1, 0.7, 0.45, 0.25, 0.1]);
  });
});

describe("the venue check's verdict", () => {
  const candidate = {
    text: "Setup I use for outreach: apify scrapes TikTok by niche hashtags. Claude drafts every email.",
    rawText: "Setup I use for outreach: apify scrapes TikTok by niche hashtags. Claude drafts every email.",
  };
  const sentences = { s0: "Setup I use for outreach: apify scrapes TikTok by niche hashtags.", s1: "Claude drafts every email." };
  const answer = (over: Record<string, unknown> = {}) => ({
    moment: "workflow",
    checks: { on_the_job: true, readers_buy: true, reply_adds_value: true, not_a_rival: true, genuine: true, not_vulnerable: true },
    worth_reply: true,
    why: "Shows a TikTok scraping step others copy; a cheaper per-request source fits it.",
    quote: "s0",
    ...over,
  });

  it("shows a venue only when every check holds, with a moment, and the author's own sentence", () => {
    const verdict = venueVerdict(answer(), candidate, sentences);
    expect(verdict).toMatchObject({ worth: true, moment: "workflow", quote: sentences.s0 });
    expect(verdict.raw).toMatchObject({ check: "venue" });
    for (const check of ["on_the_job", "readers_buy", "reply_adds_value", "not_a_rival", "genuine", "not_vulnerable"]) {
      const checks = { ...answer().checks, [check]: false };
      expect(venueVerdict(answer({ checks }), candidate, sentences).worth).toBe(false);
    }
    expect(venueVerdict(answer({ moment: "none" }), candidate, sentences).worth).toBe(false);
    expect(venueVerdict(answer({ quote: "none" }), candidate, sentences).worth).toBe(false);
    expect(venueVerdict(answer(), candidate, { s0: "Words the author never wrote." }).worth).toBe(false);
  });

  it("teaches the kind with other products' posts, and never AnyAPI's search words", () => {
    expect(VENUE_SYSTEM).toMatch(/Calendly\+\+/u);
    expect(VENUE_SYSTEM).toMatch(/DataForSEO/u);
    expect(VENUE_SYSTEM).not.toMatch(/"x api"/u);
  });
});

describe("when X is quiet for a product", () => {
  const day = 24 * 3_600_000;
  const firstLookDays = FIRST_LOOK_HOURS / 24;
  const totals = (over: Partial<Parameters<typeof quietFrom>[0]> = {}) => {
    const first = new Date(NOW.getTime() - 3_600_000);
    return { runs: 1, first, firstEver: first, firstEverFull: true, enabledAt: first, posts: 40, shown: 0, pending: 0, ...over };
  };

  it("is quiet the day an empty first look read the last month, and says the month", () => {
    expect(quietFrom(totals(), NOW)).toMatchObject({ quiet: true, days: firstLookDays, posts: 40 });
  });

  it("does not claim the month when a lane of the first look stopped short of it", () => {
    expect(quietFrom(totals({ firstEverFull: false }), NOW)).toMatchObject({ quiet: true, days: 0 });
  });

  it("is not quiet while posts it found still wait to be judged", () => {
    expect(quietFrom(totals({ pending: 12 }), NOW).quiet).toBe(false);
  });

  it("needs most of a week watched when coming back after the first look left the lookback", () => {
    const enabledAt = new Date(NOW.getTime() - 40 * day);
    const returned = new Date(NOW.getTime() - 3_600_000);
    expect(quietFrom(totals({ runs: 9, first: returned, firstEver: enabledAt, enabledAt }), NOW)).toMatchObject({ quiet: false, days: 0 });
    const fiveDays = new Date(NOW.getTime() - 5 * day);
    expect(quietFrom(totals({ runs: 9, first: fiveDays, firstEver: enabledAt, enabledAt, posts: 12 }), NOW)).toMatchObject({ quiet: true, days: 5 });
  });

  it("does not take a run long after X was turned on for the month-long first look", () => {
    // Run history is kept 90 days: a project back after that has a new earliest run, which read days, not a month.
    const returned = new Date(NOW.getTime() - 3_600_000);
    expect(quietFrom(totals({ first: returned, firstEver: returned, enabledAt: new Date(NOW.getTime() - 100 * day) }), NOW).quiet).toBe(false);
  });

  it("is not quiet with anything shown, or before any scan read X", () => {
    expect(quietFrom(totals({ runs: 10, shown: 1 }), NOW).quiet).toBe(false);
    expect(quietFrom(totals({ runs: 0, first: null, firstEver: null }), NOW).quiet).toBe(false);
    expect(quietFrom(totals({ runs: 3, first: null }), NOW).quiet).toBe(false);
  });
});
