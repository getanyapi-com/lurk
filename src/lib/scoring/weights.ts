import { z } from "zod";

/**
 * What a project's owner says matters most when leads are ranked. The gates
 * and the lead model still decide who is a lead at all (scan/gates.ts); these
 * weights only decide the order of the leads that passed, and so the 50-100
 * score each one shows. Two products can find the same post: one sells to a
 * few communities and wants those first, another wants whoever is asking
 * outright first, and one fixed fold could never be right for both.
 *
 * Pure, so the Product page can show the new order before anything is saved.
 */

export const FACTORS = ["match", "intent", "fresh", "community"] as const;
export type ScoringFactor = (typeof FACTORS)[number];

export const LEVELS = ["off", "low", "normal", "high"] as const;
export type WeightLevel = (typeof LEVELS)[number];

/** How much a level counts against the others. High is twice normal, which is twice low. */
export const LEVEL_WEIGHT: Record<WeightLevel, number> = { off: 0, low: 1, normal: 2, high: 4 };

export const FACTOR_LABEL: Record<ScoringFactor, string> = {
  match: "Match to your product",
  intent: "Buying intent",
  fresh: "Fresh, open thread",
  community: "Communities you favour",
};

export const FACTOR_HINT: Record<ScoringFactor, string> = {
  match: "How sure the scorer is that this person wants what you sell.",
  intent: "How openly they ask: has the problem, looking, asking what to use, ready to buy.",
  fresh: "Posted in the last day or three, with few replies yet.",
  community: "Posted in one of the subreddits you pick below.",
};

export type ScoringWeights = Record<ScoringFactor, WeightLevel>;

export type ScoringSettings = {
  weights: ScoringWeights;
  /** Subreddits, lowercase and without r/, whose leads the community factor lifts. */
  communities: string[];
};

/**
 * What every project ranked by before this setting existed: the lead model's
 * verdict at four times the weight of the thread's freshness (scan/constants.ts
 * foldScore), so a project nobody has tuned keeps exactly the order it had.
 */
export const DEFAULT_SCORING: ScoringSettings = {
  weights: { match: "high", intent: "off", fresh: "low", community: "off" },
  communities: [],
};

const level = z.enum(LEVELS);

export const scoringSchema = z
  .object({
    weights: z.object({ match: level, intent: level, fresh: level, community: level }),
    communities: z.array(z.string().trim().min(1).max(64)).max(100),
  })
  .refine((value) => FACTORS.some((factor) => value.weights[factor] !== "off"), {
    message: "Turn at least one factor on.",
  });

/** A subreddit the way the list stores it: lowercase, no r/. */
export function communityKey(name: string): string {
  return name.trim().replace(/^\/?r\//i, "").toLowerCase();
}

/**
 * The project's stored settings, or null when it has none or they no longer
 * parse. Null is not the default: it tells the scorers the owner never chose,
 * so each keeps its own fold.
 */
export function parseScoring(stored: unknown): ScoringSettings | null {
  const parsed = scoringSchema.safeParse(stored);
  if (!parsed.success) {
    return null;
  }
  return {
    weights: parsed.data.weights,
    communities: [...new Set(parsed.data.communities.map(communityKey))].filter(Boolean),
  };
}

/** What one lead brings to the ranking, each read on a 0-1 scale. */
export type LeadFactors = {
  /** The lead model's verdict, 0-1 with its threshold at 0.5 (scan/leadModel.ts). */
  quality: number | null;
  intent: number | null;
  engagement: number | null;
  subreddit: string | null;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Each factor as a 0-1 value. Match is how far over the lead model's bar the person is. */
export function factorValues(lead: LeadFactors, communities: string[]): Record<ScoringFactor, number> {
  const favoured = new Set(communities.map(communityKey));
  return {
    match: clamp01(((lead.quality ?? 0.5) - 0.5) / 0.5),
    intent: clamp01((lead.intent ?? 0) / 4),
    fresh: clamp01((lead.engagement ?? 0) / 4),
    community: lead.subreddit && favoured.has(communityKey(lead.subreddit)) ? 1 : 0,
  };
}

/** The weighted mean of the factors that are on, 0-1. */
function weightedMean(values: Record<ScoringFactor, number>, weights: ScoringWeights, factors: readonly ScoringFactor[]): number | null {
  let total = 0;
  let sum = 0;
  for (const factor of factors) {
    const weight = LEVEL_WEIGHT[weights[factor]];
    total += weight;
    sum += weight * values[factor];
  }
  return total === 0 ? null : sum / total;
}

/**
 * A Reddit lead's 0-100 score. A qualified lead (quality at or over 0.5) lands
 * in 50-100, as it always did, so the minimum score and the alert floor keep
 * their meaning whatever the weights; under the bar it is the lead model's
 * verdict alone, since weights order leads and never admit one.
 */
export function redditScore(lead: LeadFactors, scoring: ScoringSettings | null): number {
  const q = lead.quality ?? 0;
  if (q < 0.5) {
    return Math.min(49, Math.round(98 * q));
  }
  const settings = scoring ?? DEFAULT_SCORING;
  const mean = weightedMean(factorValues(lead, settings.communities), settings.weights, FACTORS);
  return Math.round(50 + 50 * (mean ?? factorValues(lead, []).match));
}

/**
 * The factors an X ask is ranked on. X has no subreddit, so the community
 * factor never applies there, and match is the 0-4 fit the X judge folds
 * (x/gates.ts fitFrom) rather than a lead model's verdict.
 */
const X_FACTORS: readonly ScoringFactor[] = ["match", "intent", "fresh"];

/**
 * An X ask's 0-100 score under the owner's weights, or null when they never
 * set any (or turned on only a factor X cannot read), so the X judge's own
 * fold stands.
 */
export function xAskScore(
  lead: { fit: number | null; intent: number | null; engagement: number | null },
  scoring: ScoringSettings | null,
): number | null {
  if (!scoring) {
    return null;
  }
  const values: Record<ScoringFactor, number> = {
    match: clamp01((lead.fit ?? 0) / 4),
    intent: clamp01((lead.intent ?? 0) / 4),
    fresh: clamp01((lead.engagement ?? 0) / 4),
    community: 0,
  };
  const mean = weightedMean(values, scoring.weights, X_FACTORS);
  return mean === null ? null : Math.round(100 * mean);
}

/** One factor, in words, for how this lead reads on it. */
function describe(factor: ScoringFactor, value: number): string {
  switch (factor) {
    case "match":
      return value >= 0.66 ? "a close match to your product" : value >= 0.33 ? "a good match to your product" : "a match only just over the bar";
    case "intent":
      return value >= 1 ? "being ready to buy" : value >= 0.75 ? "asking what to use" : value >= 0.5 ? "looking for a fix" : "barely asking";
    case "fresh":
      return value >= 1 ? "a fresh thread nobody has answered" : value >= 0.75 ? "a fresh thread with room to reply" : value >= 0.5 ? "a thread still open" : "an older or crowded thread";
    case "community":
      return value >= 1 ? "being in a community you favour" : "being outside the communities you favour";
  }
}

function list(parts: string[]): string {
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The line that says why a lead ranks where it does, under the weights in
 * force: what lifted it and what held it back, strongest weight first. Only
 * factors the owner has on are named, so changing a weight changes the line.
 */
export function rankingSentence(lead: LeadFactors, scoring: ScoringSettings | null): string {
  const settings = scoring ?? DEFAULT_SCORING;
  const values = factorValues(lead, settings.communities);
  const on = FACTORS.filter((factor) => settings.weights[factor] !== "off").sort(
    (a, b) => LEVEL_WEIGHT[settings.weights[b]] - LEVEL_WEIGHT[settings.weights[a]],
  );
  const score = redditScore(lead, scoring);
  const lifted = on.filter((factor) => values[factor] >= 0.5).map((factor) => describe(factor, values[factor]));
  const held = on.filter((factor) => values[factor] < 0.5).map((factor) => describe(factor, values[factor]));
  const parts = [`Scores ${score}.`];
  if (lifted.length > 0) {
    parts.push(`Lifted by ${list(lifted)}.`);
  }
  if (held.length > 0) {
    parts.push(`Held back by ${list(held)}.`);
  }
  return parts.join(" ");
}
