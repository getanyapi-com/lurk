import { describe, expect, it } from "vitest";
import { buildStream, groupByDay, type CardLead } from "@/components/leads/stream";
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

  it("still groups the people strip by day, newest day first", () => {
    const face = (id: string, ageDays: number): LeadFace => ({
      id,
      at: new Date(Date.now() - ageDays * DAY_MS),
      score: 70,
      author: "asker",
      avatarUrl: null,
      subreddit: "hotels",
    });

    const days = groupByDay([face("strong", 20), face("weak", 1)]);

    expect(days.map((day) => day.faces.map((one) => one.id))).toEqual([["weak"], ["strong"]]);
  });
});
