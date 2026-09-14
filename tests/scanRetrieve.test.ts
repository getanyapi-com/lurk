import { describe, expect, it } from "vitest";
import {
  byStaleness,
  byWorth,
  coverageTimeframe,
  explorationPick,
  googleFeedQuery,
  listingStop,
  needsWideSweep,
  retrieved,
  scopedQuery,
  unproven,
  type PlanRow,
} from "@/lib/scan/coverage";
import { refsOf } from "@/lib/scan/sources";

/**
 * How one scan decides what to cover, proved without a database or an upstream:
 * which window each row is asked for, when a walk may stop, which rows get the
 * scan's slots, and which plan rows a candidate's sources credit.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-09-06T12:00:00Z");
const WINDOW = 30 * DAY;
const OVERLAP = 6 * HOUR;

function row(patch: Partial<PlanRow> = {}): PlanRow {
  return {
    id: patch.id ?? "row-1",
    table: patch.table ?? "keyword",
    key: patch.key ?? "form builder",
    source: patch.source ?? "serp",
    state: patch.state ?? "active",
    evidence: patch.evidence ?? 0,
    lastCoveredAt: patch.lastCoveredAt ?? null,
  };
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("the window a row is asked for", () => {
  it("backfills a row it has never covered", () => {
    expect(
      coverageTimeframe({ lastCoveredAt: null, now: NOW, windowMs: WINDOW, overlapMs: OVERLAP }),
    ).toBe("month");
  });

  it("backfills a row whose watermark has fallen out of the feed window", () => {
    expect(
      coverageTimeframe({
        lastCoveredAt: ago(WINDOW + DAY),
        now: NOW,
        windowMs: WINDOW,
        overlapMs: OVERLAP,
      }),
    ).toBe("month");
  });

  it("asks for a day when the last scan is inside one, overlap included", () => {
    expect(
      coverageTimeframe({
        lastCoveredAt: ago(12 * HOUR),
        now: NOW,
        windowMs: WINDOW,
        overlapMs: OVERLAP,
      }),
    ).toBe("day");
  });

  it("asks for a week once the overlap pushes the gap past a day", () => {
    expect(
      coverageTimeframe({
        lastCoveredAt: ago(20 * HOUR),
        now: NOW,
        windowMs: WINDOW,
        overlapMs: OVERLAP,
      }),
    ).toBe("week");
  });

  it("asks for a month once a week can no longer reach the watermark", () => {
    expect(
      coverageTimeframe({
        lastCoveredAt: ago(8 * DAY),
        now: NOW,
        windowMs: WINDOW,
        overlapMs: OVERLAP,
      }),
    ).toBe("month");
  });

  it("owes a wide sweep to a query that has not had one for a week", () => {
    expect(needsWideSweep(null, NOW)).toBe(true);
    expect(needsWideSweep(ago(8 * DAY), NOW)).toBe(true);
    expect(needsWideSweep(ago(2 * DAY), NOW)).toBe(false);
  });
});

describe("when a listing walk stops", () => {
  const watermark = ago(2 * DAY);

  it("stops as soon as a post older than the watermark appears", () => {
    expect(
      listingStop({
        posts: [{ createdAt: ago(HOUR) }, { createdAt: ago(3 * DAY) }],
        nextCursor: "more",
        page: 0,
        pages: 4,
        watermark,
      }),
    ).toBe("covered");
  });

  it("stops when the listing has nothing left to hand back", () => {
    expect(
      listingStop({ posts: [{ createdAt: ago(HOUR) }], nextCursor: null, page: 0, pages: 4, watermark }),
    ).toBe("exhausted");
    expect(listingStop({ posts: [], nextCursor: "more", page: 0, pages: 4, watermark })).toBe(
      "exhausted",
    );
  });

  it("stops on the page budget, which is the only stop that leaves a gap", () => {
    expect(
      listingStop({
        posts: [{ createdAt: ago(HOUR) }],
        nextCursor: "more",
        page: 1,
        pages: 2,
        watermark,
      }),
    ).toBe("budget");
  });

  it("keeps walking while there are pages left and the watermark is not reached", () => {
    expect(
      listingStop({
        posts: [{ createdAt: ago(HOUR) }],
        nextCursor: "more",
        page: 0,
        pages: 2,
        watermark,
      }),
    ).toBe("continue");
  });
});

describe("which rows get this scan's slots", () => {
  it("retrieves the active and the pinned, and explores only the candidates", () => {
    const rows = [
      row({ id: "a", state: "active" }),
      row({ id: "b", state: "pinned" }),
      row({ id: "c", state: "candidate" }),
      row({ id: "d", state: "excluded" }),
    ];
    expect(retrieved(rows).map((one) => one.id)).toEqual(["a", "b"]);
    expect(unproven(rows).map((one) => one.id)).toEqual(["c"]);
  });

  it("puts the row that has gone longest without coverage first", () => {
    const rows = [
      row({ id: "recent", lastCoveredAt: ago(HOUR) }),
      row({ id: "never" }),
      row({ id: "old", lastCoveredAt: ago(5 * DAY) }),
    ];
    expect(byStaleness(rows).map((one) => one.id)).toEqual(["never", "old", "recent"]);
  });

  it("gives the exploration slot to the stalest candidate of either kind", () => {
    const queries = [row({ id: "q", state: "candidate", lastCoveredAt: ago(DAY) })];
    const communities = [
      row({ id: "c", table: "community", state: "candidate", lastCoveredAt: ago(3 * DAY) }),
      row({ id: "active", table: "community", state: "active" }),
    ];
    expect(explorationPick(queries, communities)?.id).toBe("c");
    expect(explorationPick([], [row({ state: "active" })])).toBeNull();
  });
});

describe("what each source asks for", () => {
  it("scopes a search to one community in Reddit's Boolean form", () => {
    expect(scopedQuery("hotels", "pet friendly OR dog friendly")).toBe(
      "subreddit:hotels AND (pet friendly OR dog friendly)",
    );
  });

  /** One form for every Google question, so two callers share one paid run. */
  it("turns a Reddit Boolean query into the app's one Google question", () => {
    expect(googleFeedQuery("subreddit:hotels AND (pet friendly OR dog friendly)")).toBe(
      "pet friendly dog friendly reddit",
    );
  });
});

describe("which plan rows a candidate credits", () => {
  it("credits every row behind every source, once each", () => {
    const query = row({ id: "q1", table: "keyword" });
    const community = row({ id: "c1", table: "community", key: "hotels" });
    expect(
      refsOf([
        { kind: "search", key: "form builder", rows: [query] },
        { kind: "scoped", key: "subreddit:hotels AND (form builder)", rows: [community, query] },
        { kind: "listing", key: "hotels", rows: [community] },
      ]),
    ).toEqual([
      { table: "keyword", id: "q1" },
      { table: "community", id: "c1" },
    ]);
  });
});

/**
 * A scan buys fewer searches than a plan holds rows, and staleness alone gave
 * every row the same claim on them: on lurk.so on 2026-09-14 `instagram api`,
 * whose Google results the model called relevant six times, took its turn
 * behind `ahrefs api`, which it called relevant three times. The evidence
 * decides now, after every row has had one turn.
 */
describe("the order a scan spends its searches in", () => {
  const at = (row: Partial<PlanRow>): PlanRow => ({
    id: row.key ?? "row",
    table: "keyword",
    key: row.key ?? "row",
    source: "serp",
    state: "active",
    lastCoveredAt: row.lastCoveredAt ?? null,
    evidence: row.evidence ?? 0,
  });

  it("spends on the best evidence once every row has had a turn", () => {
    const ordered = byWorth([
      at({ key: "ahrefs api", evidence: 3, lastCoveredAt: new Date("2026-09-14T00:00:00Z") }),
      at({ key: "instagram api", evidence: 6, lastCoveredAt: new Date("2026-09-14T06:00:00Z") }),
      at({ key: "seo api", evidence: 2, lastCoveredAt: new Date("2026-09-13T00:00:00Z") }),
    ]);
    expect(ordered.map((row) => row.key)).toEqual(["instagram api", "ahrefs api", "seo api"]);
  });

  it("gives a row nothing has covered its turn before any evidence is weighed", () => {
    const ordered = byWorth([
      at({ key: "instagram api", evidence: 6, lastCoveredAt: new Date("2026-09-14T06:00:00Z") }),
      at({ key: "linkedin scraper", evidence: 0, lastCoveredAt: null }),
    ]);
    expect(ordered.map((row) => row.key)).toEqual(["linkedin scraper", "instagram api"]);
  });

  it("rotates two rows of equal evidence by staleness", () => {
    const ordered = byWorth([
      at({ key: "fresh", evidence: 4, lastCoveredAt: new Date("2026-09-14T06:00:00Z") }),
      at({ key: "stale", evidence: 4, lastCoveredAt: new Date("2026-09-10T06:00:00Z") }),
    ]);
    expect(ordered.map((row) => row.key)).toEqual(["stale", "fresh"]);
  });
});
