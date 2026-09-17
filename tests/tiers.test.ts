import { describe, expect, it } from "vitest";
import { TIERS, limitsFor } from "@/lib/tiers";

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

  it("removes every limit when self-hosted", () => {
    expect(limitsFor("free", true)).toBeNull();
    expect(limitsFor("free", false)).toBe(TIERS.free);
  });
});
