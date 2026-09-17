/**
 * Tier limits from the product plan. Free is the hosted anonymous-wallet tier;
 * connected is a user who authorized an AnyAPI wallet. Self-host has no limits
 * at all, which `limitsFor` expresses by returning null.
 */
export type TierName = "free" | "connected";

export type TierLimits = {
  projects: number | null;
  keywordsPerProject: number | null;
  subredditsPerProject: number | null;
  feedWindowDays: number;
  /** Custom webhooks. Slack and Discord are free to post to, so they are uncapped. */
  customWebhooks: number | null;
  alertCadence: "daily" | "hourly";
  seoKeywords: number | null;
  seoRefreshDays: number;
  competitors: number | null;
  /** Null means no daily cap, which is what a connected wallet buys. */
  apiRequestsPerDay: number | null;
  /**
   * What discovery and one scan may buy. The starting values come from the
   * accepted second opinion and Kevin reviews them.
   */
  discoveryQueries: number;
  discoveryQueriesMax: number;
  searchesPerScan: number;
  scopedSearchesPerScan: number;
  listingPilotsPerScan: number;
  serpQueriesPerDay: number;
  searchPagesPerQuery: number;
  hydrationPerScan: number;
  discoveryRefreshDays: number;
};

export const TIERS: Record<TierName, TierLimits> = {
  free: {
    projects: 2,
    keywordsPerProject: 25,
    subredditsPerProject: 10,
    feedWindowDays: 30,
    customWebhooks: 1,
    alertCadence: "daily",
    seoKeywords: 10,
    seoRefreshDays: 7,
    competitors: 3,
    apiRequestsPerDay: 1000,
    discoveryQueries: 8,
    discoveryQueriesMax: 12,
    searchesPerScan: 8,
    scopedSearchesPerScan: 2,
    listingPilotsPerScan: 2,
    serpQueriesPerDay: 2,
    searchPagesPerQuery: 2,
    hydrationPerScan: 40,
    discoveryRefreshDays: 7,
  },
  connected: {
    projects: null,
    keywordsPerProject: null,
    subredditsPerProject: null,
    feedWindowDays: 30,
    customWebhooks: null,
    alertCadence: "hourly",
    seoKeywords: null,
    seoRefreshDays: 1,
    competitors: null,
    apiRequestsPerDay: null,
    discoveryQueries: 12,
    discoveryQueriesMax: 20,
    searchesPerScan: 16,
    scopedSearchesPerScan: 4,
    listingPilotsPerScan: 4,
    serpQueriesPerDay: 6,
    searchPagesPerQuery: 4,
    hydrationPerScan: 100,
    discoveryRefreshDays: 3,
  },
};

/** Days shared Reddit rows are kept from their creation time. */
export const RETENTION_DAYS = 30;

/** Null means "no limit", which is what a self-hosted instance always gets. */
export function limitsFor(tier: TierName, selfHosted: boolean): TierLimits | null {
  return selfHosted ? null : TIERS[tier];
}
