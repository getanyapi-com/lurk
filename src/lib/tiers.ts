/**
 * Tier limits from the product plan. Free is the hosted anonymous-wallet tier;
 * connected is a user who authorized an AnyAPI wallet. Self-host has no limits
 * at all, which `limitsFor` expresses by returning null.
 */
export type TierName = "free" | "connected";

/** The buttons that spend money on a press, which each tier rations per user. */
export type PaidAction =
  | "scan_now"
  | "rebuild_profile"
  | "seo_refresh"
  | "competitor_scan"
  | "insights"
  | "x_scan_now";

/** Whether a tier's presses come back after 24 hours, or are spent for good. */
export type ActionWindow = "day" | "ever";

/**
 * What X leads may buy for one project (src/lib/x). Every tier runs every
 * search lurk writes and judges as much; a wallet buys freshness (hourly, a
 * second page, Scan now), never features. An X search page costs $0.00065
 * whether it holds 20 posts or none, so everything here is counted in pages
 * and calls. Free at every cap is about $0.07 a project-day, typically about
 * a cent, and the house's X sub-caps bound the total whatever the user count.
 */
export type XLimits = {
  /** Searches the project runs; null is every one lurk writes for it (usually 4 to 14). */
  lanes: number | null;
  /** How often a scan runs, and the longest a quiet search may back off to. */
  cadenceHours: number;
  maxBackoffHours: number;
  /** Page 2 is only ever taken after a full page 1. */
  pagesPerLane: number;
  pagesPerDay: number | null;
  /** How far a reply is walked up to what it answers, and how many such lookups a day. */
  parentHops: number;
  parentsPerDay: number | null;
  /** First judgements, and bios bought for the complete one, a day. */
  judgedPerDay: number | null;
  profilesPerDay: number | null;
  /** Posts a day checked for whether they are worth a reply, one Muse call each. */
  replyChecksPerDay: number | null;
};

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
   * How many times one user may press each paid button, across all their
   * projects: in any 24 hours, or ever. Free gets each once for good, because
   * a rebuild or a refresh is dear and the house pays for it; zero means the
   * button is off, which is free's Scan now.
   */
  actions: { window: ActionWindow; presses: Record<PaidAction, number> };
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
  x: XLimits;
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
    actions: {
      window: "ever",
      presses: {
        scan_now: 0,
        rebuild_profile: 1,
        seo_refresh: 1,
        competitor_scan: 1,
        insights: 1,
        x_scan_now: 0,
      },
    },
    discoveryQueries: 8,
    discoveryQueriesMax: 12,
    searchesPerScan: 8,
    scopedSearchesPerScan: 2,
    listingPilotsPerScan: 2,
    serpQueriesPerDay: 2,
    searchPagesPerQuery: 2,
    hydrationPerScan: 40,
    discoveryRefreshDays: 7,
    // Every search lurk writes, once a day: a search page is $0.00065, so
    // breadth costs the house cents; hourly freshness is what a wallet buys.
    x: {
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
    },
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
    actions: {
      window: "day",
      presses: {
        scan_now: 10,
        rebuild_profile: 2,
        seo_refresh: 2,
        competitor_scan: 2,
        insights: 2,
        x_scan_now: 10,
      },
    },
    discoveryQueries: 12,
    discoveryQueriesMax: 20,
    searchesPerScan: 16,
    scopedSearchesPerScan: 4,
    listingPilotsPerScan: 4,
    serpQueriesPerDay: 6,
    searchPagesPerQuery: 4,
    hydrationPerScan: 100,
    discoveryRefreshDays: 3,
    x: {
      lanes: null,
      cadenceHours: 1,
      maxBackoffHours: 8,
      pagesPerLane: 2,
      pagesPerDay: 150,
      parentHops: 3,
      parentsPerDay: 40,
      judgedPerDay: 150,
      profilesPerDay: 20,
      replyChecksPerDay: 15,
    },
  },
};

/** Days shared Reddit rows are kept from their creation time. */
export const RETENTION_DAYS = 30;

/**
 * X's limits for a tier's limits. Self-hosted (null) runs at the connected
 * shape with no caps at all: the operator's own keys, the operator's call.
 */
export function xLimitsFor(limits: TierLimits | null): XLimits {
  if (limits) {
    return limits.x;
  }
  return {
    ...TIERS.connected.x,
    lanes: null,
    pagesPerDay: null,
    parentsPerDay: null,
    judgedPerDay: null,
    profilesPerDay: null,
    replyChecksPerDay: null,
  };
}

/** Null means "no limit", which is what a self-hosted instance always gets. */
export function limitsFor(tier: TierName, selfHosted: boolean): TierLimits | null {
  return selfHosted ? null : TIERS[tier];
}
