import { describe, expect, it } from "vitest";
import { TIERS, limitsFor, xLimitsFor } from "@/lib/tiers";

describe("tiers", () => {
  it("keeps the free tier's published numbers", () => {
    expect(TIERS.free.projects).toBe(2);
    expect(TIERS.free.keywordsPerProject).toBe(25);
    expect(TIERS.free.subredditsPerProject).toBe(10);
    expect(TIERS.free.seoKeywords).toBe(10);
    expect(TIERS.free.competitors).toBe(3);
    expect(TIERS.free.apiRequestsPerDay).toBe(1000);
  });

  it("makes a connected wallet buy freshness and breadth, not features", () => {
    expect(TIERS.connected.projects).toBeNull();
    expect(TIERS.connected.apiRequestsPerDay).toBeNull();
    expect(TIERS.connected.feedWindowDays).toBe(TIERS.free.feedWindowDays);
  });

  it("gives every tier a whole retrieval budget, connected wider than free", () => {
    const budget = [
      "discoveryQueries",
      "discoveryQueriesMax",
      "searchesPerScan",
      "scopedSearchesPerScan",
      "listingPilotsPerScan",
      "serpQueriesPerDay",
      "searchPagesPerQuery",
      "hydrationPerScan",
    ] as const;
    for (const key of budget) {
      expect(TIERS.free[key]).toBeGreaterThan(0);
      expect(TIERS.connected[key]).toBeGreaterThan(TIERS.free[key]);
    }
    expect(TIERS.free.discoveryQueries).toBe(8);
    expect(TIERS.free.discoveryQueriesMax).toBe(12);
    expect(TIERS.free.discoveryRefreshDays).toBe(7);
    expect(TIERS.connected.discoveryRefreshDays).toBeLessThan(TIERS.free.discoveryRefreshDays);
  });

  it("runs every X search on free once a day, and gives a wallet the same breadth fresher", () => {
    expect(TIERS.free.x).toEqual({
      lanes: null,
      cadenceHours: 24,
      maxBackoffHours: 24,
      pagesPerLane: 1,
      pagesPerDay: 30,
      parentHops: 3,
      parentsPerDay: 40,
      judgedPerDay: 150,
      profilesPerDay: 20,
      replyChecksPerDay: 15,
    });
    expect(TIERS.connected.x.lanes).toBeNull();
    expect(TIERS.connected.x.judgedPerDay).toBe(TIERS.free.x.judgedPerDay);
    expect(TIERS.connected.x.pagesPerLane).toBeGreaterThan(TIERS.free.x.pagesPerLane);
    expect(TIERS.connected.x.cadenceHours).toBeLessThan(TIERS.free.x.cadenceHours);
    expect(TIERS.free.actions.presses.x_scan_now).toBe(0);
    expect(TIERS.connected.actions.presses.x_scan_now).toBeGreaterThan(0);
  });

  it("keeps X at the connected shape with no caps when self-hosted", () => {
    const x = xLimitsFor(null);
    expect(x.cadenceHours).toBe(TIERS.connected.x.cadenceHours);
    expect([x.lanes, x.pagesPerDay, x.parentsPerDay, x.judgedPerDay, x.profilesPerDay, x.replyChecksPerDay]).toEqual([
      null, null, null, null, null, null,
    ]);
    expect(xLimitsFor(TIERS.free)).toBe(TIERS.free.x);
  });

  it("removes every limit when self-hosted", () => {
    expect(limitsFor("free", true)).toBeNull();
    expect(limitsFor("free", false)).toBe(TIERS.free);
  });
});
