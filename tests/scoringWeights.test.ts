import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { foldScore as xFoldScore } from "@/lib/x/gates";
import {
  DEFAULT_SCORING,
  parseScoring,
  rankingSentence,
  redditScore,
  scoringSchema,
  xAskScore,
  type LeadFactors,
  type ScoringSettings,
} from "@/lib/scoring/weights";
import { describeDb, makePost, makeProject, makeUser } from "./fixtures/db";

/**
 * The owner's ranking weights. Every project that never set any has to keep
 * the order it had, and two products looking at the same posts have to be
 * able to rank them differently.
 */

/**
 * The order every project had before weights existed: under the lead model's
 * bar its verdict alone, over it the verdict at four times the thread's
 * freshness.
 */
function foldedBeforeWeights(quality: number, engagement: number): number {
  if (quality < 0.5) {
    return Math.min(49, Math.round(98 * quality));
  }
  return Math.round(50 + 50 * ((0.8 * (quality - 0.5)) / 0.5 + (0.2 * engagement) / 4));
}

describe("ranking weights", () => {
  it("rank exactly as before when nobody chose any", () => {
    for (let quality = 0; quality <= 1; quality += 0.01) {
      for (let engagement = 0; engagement <= 4; engagement += 1) {
        const lead = { quality, intent: 2, engagement, subreddit: "saas" };
        expect(redditScore(lead, null)).toBe(foldedBeforeWeights(quality, engagement));
        expect(redditScore(lead, DEFAULT_SCORING)).toBe(foldedBeforeWeights(quality, engagement));
      }
    }
    expect(redditScore({ quality: null, intent: 4, engagement: 4, subreddit: null }, null)).toBe(0);
  });

  it("keep every qualified lead at 50 or over and every other one under", () => {
    const heavy: ScoringSettings = {
      weights: { match: "off", intent: "high", fresh: "off", community: "high" },
      communities: ["forms"],
    };
    expect(redditScore({ quality: 0.5, intent: 0, engagement: 0, subreddit: "other" }, heavy)).toBe(50);
    expect(redditScore({ quality: 0.49, intent: 4, engagement: 4, subreddit: "forms" }, heavy)).toBeLessThan(50);
    expect(redditScore({ quality: 0.6, intent: 4, engagement: 0, subreddit: "Forms" }, heavy)).toBe(100);
  });

  it("let two products rank the same posts in different orders", () => {
    // One post in the owner's own community, fresh but only looking; one
    // elsewhere, older, asking outright for a tool. The model likes both alike.
    const inCommunity: LeadFactors = { quality: 0.75, intent: 2, engagement: 4, subreddit: "shopify" };
    const outrightAsk: LeadFactors = { quality: 0.75, intent: 4, engagement: 0, subreddit: "smallbusiness" };
    const communityFirst: ScoringSettings = {
      weights: { match: "normal", intent: "off", fresh: "low", community: "high" },
      communities: ["shopify"],
    };
    const intentFirst: ScoringSettings = {
      weights: { match: "normal", intent: "high", fresh: "off", community: "off" },
      communities: [],
    };
    expect(redditScore(inCommunity, communityFirst)).toBeGreaterThan(redditScore(outrightAsk, communityFirst));
    expect(redditScore(outrightAsk, intentFirst)).toBeGreaterThan(redditScore(inCommunity, intentFirst));
  });

  it("say in the ranking line what lifted a lead and what held it back, under the weights in force", () => {
    const lead: LeadFactors = { quality: 0.95, intent: 4, engagement: 0, subreddit: "shopify" };
    const byDefault = rankingSentence(lead, null);
    expect(byDefault).toMatch(/^Scores \d+\./);
    expect(byDefault).toContain("a close match to your product");
    expect(byDefault).toContain("Held back by an older or crowded thread");
    expect(byDefault).not.toContain("ready to buy");

    const withIntent = rankingSentence(lead, {
      weights: { match: "low", intent: "high", fresh: "off", community: "normal" },
      communities: ["shopify"],
    });
    expect(withIntent).toContain("Lifted by being ready to buy, being in a community you favour and a close match");
    expect(withIntent).not.toContain("thread");
  });

  it("leave X asks on the judge's fold until the owner chooses, then weigh them the same way", () => {
    const ask = { fit: 3, intent: 4, engagement: 1 };
    expect(xAskScore(ask, null)).toBeNull();
    expect(xAskScore(ask, { weights: { match: "normal", intent: "normal", fresh: "low", community: "off" }, communities: [] })).toBe(
      xFoldScore(3, 4, 1),
    );
    // Match and freshness off, so an ask ranks on intent alone.
    expect(xAskScore(ask, { weights: { match: "off", intent: "normal", fresh: "off", community: "high" }, communities: ["x"] })).toBe(100);
  });

  it("keep X's own intent weight when the owner only changed what X cannot read", () => {
    const favoured = { weights: { ...DEFAULT_SCORING.weights, community: "high" as const }, communities: ["saas"] };
    for (const [fit, intent, engagement] of [[3, 4, 2], [3, 1, 2], [2, 4, 0], [4, 1, 4]]) {
      expect(xAskScore({ fit, intent, engagement }, favoured)).toBeNull();
    }
    // Raising freshness alone keeps intent counting as X counts it.
    const fresher = { weights: { ...DEFAULT_SCORING.weights, fresh: "high" as const }, communities: [] };
    expect(xAskScore({ fit: 2, intent: 4, engagement: 0 }, fresher)).toBeGreaterThan(
      xAskScore({ fit: 2, intent: 1, engagement: 0 }, fresher)!,
    );
  });

  it("refuse every factor off, and store communities one way", () => {
    expect(scoringSchema.safeParse({ weights: { match: "off", intent: "off", fresh: "off", community: "off" }, communities: [] }).success).toBe(false);
    expect(parseScoring({ weights: DEFAULT_SCORING.weights, communities: ["r/Shopify", "shopify", " /r/SaaS "] })?.communities).toEqual([
      "shopify",
      "saas",
    ]);
    expect(parseScoring({ weights: { match: "loud" }, communities: [] })).toBeNull();
    expect(parseScoring(null)).toBeNull();
  });
});

describeDb("re-ranking a project's stored leads", () => {
  it("rewrites the scores the new weights move, and puts them back on reset", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { rerankProject, scoringPreview } = await import("@/lib/scoring/apply");
    const user = await makeUser();
    const project = await makeProject(user.id, { name: "Shopkeep" });
    const rows = [
      { subreddit: "shopify", quality: 0.75, intent: 2, engagement: 4 },
      { subreddit: "smallbusiness", quality: 0.75, intent: 4, engagement: 0 },
    ];
    const ids: string[] = [];
    for (const row of rows) {
      const post = await makePost({
        subreddit: row.subreddit,
        title: `A question in ${row.subreddit}`,
        url: `https://www.reddit.com/r/${row.subreddit}/comments/${randomUUID().slice(0, 6)}/q/`,
      });
      const [lead] = await db()
        .insert(schema.leads)
        .values({
          projectId: project.id,
          postId: post.id,
          score: redditScore(row, null),
          quality: row.quality,
          fit: 4,
          intent: row.intent,
          engagement: row.engagement,
          stage: "solution_seeking",
          reason: "r",
          matchedPhrase: "",
        })
        .returning();
      ids.push(lead.id);
    }
    const scores = async () => {
      const read = await db().select().from(schema.leads).where(eq(schema.leads.projectId, project.id));
      return ids.map((id) => read.find((row) => row.id === id)!.score);
    };
    const before = await scores();
    expect(before[0]).toBeGreaterThan(before[1]);

    const moved = await rerankProject(project.id, {
      weights: { match: "normal", intent: "high", fresh: "off", community: "off" },
      communities: [],
    });
    expect(moved).toBe(2);
    const after = await scores();
    expect(after[1]).toBeGreaterThan(after[0]);

    const preview = await scoringPreview(project.id);
    expect([...preview.communities].sort()).toEqual(["shopify", "smallbusiness"]);
    expect(preview.leads).toHaveLength(2);

    await rerankProject(project.id, null);
    expect(await scores()).toEqual(before);
  });
});
