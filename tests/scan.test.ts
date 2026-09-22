import { describe, expect, it, vi } from "vitest";
import { JevRequestTooLargeError } from "@/lib/jev";
import {
  TRIAGE_BATCH_SIZE,
  engagementScore,
  foldScore,
  hydrationCap,
  retrievalBudgets,
} from "@/lib/scan/constants";
import { BODY_CHAR_BUDGET, truncateBody } from "@/lib/scan/evidence";
import { decide, judge, routeLead } from "@/lib/scan/gates";
import type { Assessment, ScorableItem, TriageItem } from "@/lib/scan/judgement";
import { itemState, spans } from "@/lib/scan/spans";
import { retentionCutoff } from "@/lib/retention";
import { TIERS } from "@/lib/tiers";
import { judgeAnswers, product, triageAnswers } from "./jevAnswers";

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));

vi.mock("@/lib/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jev")>()),
  askJev,
}));

const { judgeItems, readOrder, triageTitles } = await import("@/lib/scan/score");

const item: ScorableItem = {
  id: "p1",
  title: "Looking for a form tool with logic, payments and webhooks",
  subreddit: "SaaS",
  body: "Our signup form needs conditional logic and it has to take payments.",
  author: "asker",
  ageHours: 5,
  upvotes: 4,
  numComments: 2,
  parentBody: null,
};

function assessment(patch: Partial<Assessment> = {}): Assessment {
  return {
    id: "p1",
    relationship: "buyer",
    needState: "open",
    fit: 4,
    intent: 3,
    match: 0.9,
    stage: "solution_seeking",
    decision: "qualify",
    reasonCode: "supported_open_need",
    needEvidence: { quote: "it has to take payments" },
    reason: "Wants a form that takes payments.",
    ...patch,
  };
}

describe("score folding", () => {
  it("weights match three times as heavily as intent or liveliness", () => {
    expect(foldScore(1, 4, 4)).toBe(100);
    expect(foldScore(0.9, 2, 0)).toBeGreaterThan(foldScore(0.6, 3, 1));
    expect(foldScore(0.7, 3, 1)).toBeGreaterThan(foldScore(0.7, 2, 1));
  });

  it("starts the qualified band at 50 and counts a missing scale as zero", () => {
    expect(foldScore(0.5, 2, 0)).toBe(50);
    expect(foldScore(null, null, 0)).toBe(foldScore(0, 0, 0));
    expect(foldScore(null, null, 4)).toBeLessThan(50);
  });
});

describe("engagement", () => {
  it("is computed from age and replies, never asked of the model", () => {
    expect(engagementScore(1, 0)).toBe(4);
    expect(engagementScore(200, 40)).toBe(0);
    expect(engagementScore(30, 3)).toBe(2);
  });
});

describe("the qualification gates", () => {
  it("does not let a live thread and top intent pay for a wrong-job fit", () => {
    const judged = judge(assessment({ fit: 0, intent: 4 }), { ...item, ageHours: 1, numComments: 0 });
    expect(judged.engagement).toBe(4);
    expect(judged.score).toBeGreaterThan(50);
    expect(judged.decision).toBe("reject");
    expect(judged.reasonCode).toBe("wrong_job");
  });

  it("does not qualify a need the person says is resolved", () => {
    const judged = judge(assessment({ needState: "resolved" }), item);
    expect(judged.decision).toBe("reject");
    expect(judged.reasonCode).toBe("resolved");
  });

  it("treats a helper as neither a seller nor a lead", () => {
    const judged = judge(assessment({ relationship: "helper" }), item);
    expect(judged.sellerSide).toBe(false);
    expect(judged.decision).toBe("reject");
    expect(judged.reasonCode).toBe("helper_only");
  });

  it("rejects on each settled disqualifier, and names it", () => {
    const settled = [
      [{ relationship: "seller" as const }, "seller_only"],
      [{ relationship: "helper" as const }, "helper_only"],
      [{ needState: "resolved" as const }, "resolved"],
      [{ needState: "no_active_need" as const }, "no_active_need"],
      [{ fit: 0 }, "wrong_job"],
      [
        { relationship: "unknown" as const, needState: "unknown" as const, fit: null },
        "insufficient_evidence",
      ],
    ] as const;
    for (const [patch, code] of settled) {
      const judged = judge(assessment(patch), item);
      expect([patch, judged.decision]).toEqual([patch, "reject"]);
      expect(judged.reasonCode).toBe(code);
    }
  });

  it("holds a model rejection with no settled disqualifier behind it for review", () => {
    const judged = judge(assessment({ decision: "reject", reasonCode: "wrong_audience" }), item);
    expect(judged.decision).toBe("review");
  });

  it("holds category overlap alone for review rather than rejecting the person", () => {
    const judged = judge(assessment({ fit: 1, intent: 4 }), item);
    expect(judged.decision).toBe("review");
    expect(judged.reasonCode).toBe("wrong_audience");
  });

  it("qualifies a buyer whose open need the product covers", () => {
    const judged = judge(assessment(), item);
    expect(judged.decision).toBe("qualify");
    expect(judged.matchedPhrase).toBe("it has to take payments");
  });

  it("rejects an item the model could read nothing at all into", () => {
    const judged = judge(
      assessment({
        relationship: "unknown",
        needState: "unknown",
        fit: null,
        intent: 0,
        decision: "review",
        reasonCode: "insufficient_evidence",
        needEvidence: null,
      }),
      item,
    );
    expect(judged.decision).toBe("reject");
    expect(judged.reasonCode).toBe("insufficient_evidence");
  });

  it("rejects a person it cannot place once their need or fit is settled anyway", () => {
    for (const patch of [
      { relationship: "unknown" as const, needState: "no_active_need" as const, fit: 0 },
      { relationship: "unknown" as const, needState: "open" as const, fit: 0 },
    ]) {
      const judged = judge(
        assessment({ ...patch, decision: "review", reasonCode: "insufficient_evidence" }),
        item,
      );
      expect(judged.decision).toBe("reject");
    }
  });

  it("qualifies an unsettled requirement only for someone asking outright", () => {
    expect(decide(assessment({ fit: 2, intent: 3 })).decision).toBe("qualify");
    expect(decide(assessment({ fit: 2, intent: 2 }))).toEqual({
      decision: "review",
      reasonCode: "insufficient_evidence",
    });
  });

  it("still holds a plausible buyer with one material unknown for review", () => {
    for (const patch of [
      { relationship: "buyer" as const, needState: "unknown" as const, fit: null },
      { relationship: "unknown" as const, needState: "evaluating" as const, fit: null },
      { relationship: "unknown" as const, needState: "unknown" as const, fit: 2 },
      { relationship: "discussion" as const, needState: "unknown" as const, fit: null },
    ]) {
      const judged = judge(assessment({ ...patch, decision: "review" }), item);
      expect(judged.decision).toBe("review");
    }
  });
});

describe("routing a judgement to a lane", () => {
  it("sends a buyer whose open need the product covers to the buyer lane", () => {
    expect(routeLead(assessment())).toBe("buyer");
  });

  it("keeps a helper as context when the product plainly does the job", () => {
    expect(routeLead(assessment({ relationship: "helper", fit: 3 }))).toBe("context");
  });

  it("drops a helper the product does not do the job for", () => {
    expect(routeLead(assessment({ relationship: "helper", fit: 1 }))).toBeNull();
  });

  it("drops a need the person says is already met, however good the fit", () => {
    expect(routeLead(assessment({ needState: "resolved", fit: 4 }))).toBeNull();
  });

  // Labelled 2026-09-19: 68% of context leads were not worth a comment, most
  // of them a rival being promoted or a thread the product only might fit.
  it("drops someone promoting their own thing, however good the fit", () => {
    expect(routeLead(assessment({ relationship: "seller", fit: 4 }))).toBeNull();
  });

  it("drops a thread the product only plausibly fits", () => {
    expect(routeLead(assessment({ relationship: "helper", fit: 2 }))).toBeNull();
  });
});

describe("content Reddit has taken away", () => {
  const deletedBody: ScorableItem = { ...item, id: "gone", body: "[deleted]" };
  const removedBody: ScorableItem = { ...item, id: "removed", body: "  [Removed]  " };
  const deletedAuthor: ScorableItem = { ...item, id: "ghost", author: "[deleted]" };

  it("never sends a sentinel body or a deleted author to the model", async () => {
    askJev.mockReset();
    askJev.mockResolvedValueOnce(judgeAnswers([{}]));
    const judged = await judgeItems("project-1", product, [
      item,
      deletedBody,
      removedBody,
      deletedAuthor,
    ]);
    expect(askJev).toHaveBeenCalledTimes(1);
    const call = askJev.mock.calls[0][0];
    expect(call.itemsAsked).toBe(1);
    expect(Object.keys((call.state as { posts: Record<string, unknown> }).posts)).toEqual(["p0"]);
    expect(JSON.stringify(call.state)).not.toContain("deleted");
    expect(judged.map((one) => one.id)).toEqual(["p1"]);
  });

  it("makes no model call at all when every candidate is a sentinel", async () => {
    askJev.mockReset();
    const judged = await judgeItems("project-1", product, [deletedBody, deletedAuthor]);
    expect(askJev).not.toHaveBeenCalled();
    expect(judged).toEqual([]);
  });
});

describe("judging a batch", () => {
  const commenter: ScorableItem = {
    ...item,
    id: "c1",
    body: "Same boat here, following this thread.",
    parentBody: "Our signup form needs conditional logic and it has to take payments.",
  };

  it("keeps no verdict for a batch the model never answered, so the next run judges it again", async () => {
    askJev.mockReset();
    askJev.mockRejectedValueOnce(new Error("upstream is down"));
    expect(await judgeItems("project-1", product, [item])).toEqual([]);
  });

  it("splits a batch the model refuses as too large and asks for each half", async () => {
    askJev.mockReset();
    askJev.mockRejectedValueOnce(new JevRequestTooLargeError());
    askJev.mockResolvedValue(judgeAnswers([{}]));
    const judged = await judgeItems("project-1", product, [item, { ...item, id: "p2" }]);
    expect(askJev).toHaveBeenCalledTimes(3);
    expect(askJev.mock.calls[1][0].itemsAsked).toBe(1);
    expect(judged.map((one) => one.id).sort()).toEqual(["p1", "p2"]);
  });

  it("asks the three reading questions only for a candidate no reading covers", async () => {
    askJev.mockReset();
    askJev.mockResolvedValueOnce(judgeAnswers([{}, {}]));
    await judgeItems(
      "project-1",
      product,
      [item, { ...item, id: "p2" }],
      new Map([["p1", { relationship: "buyer" as const, needState: "open" as const, quote: null }]]),
    );
    const questions = askJev.mock.calls[0][0].questions as Record<string, unknown>;
    expect(questions).not.toHaveProperty("p0__relationship");
    expect(questions).toHaveProperty("p0__solves_problem");
    expect(questions).toHaveProperty("p1__relationship");
  });

  it("shows the model plain typography, so a curly apostrophe cannot be garbled back", () => {
    const curly: ScorableItem = {
      ...item,
      title: "Hotels that \u201Callow\u201D 18 \u2013 cheap?",
      body: "some that wouldn\u2019t cost that much\u2026 \u0019ok",
    };
    const shown = Object.values(spans(curly.title, curly.body)).join(" ");
    expect(shown).toContain('Hotels that "allow" 18 - cheap?');
    expect(shown).toContain("some that wouldn't cost that much...");
    expect(shown).not.toMatch(/[\u2018\u2019\u201C\u201D\u2013\u2026\u0019]/);
  });

  it("copies the quote from the sentence the model picked, in the person's own words", async () => {
    const typography: ScorableItem = {
      ...item,
      body: "Our signup form needs\n\n  conditional logic \u2013 and it\u2019s got to take \\*payments\\*.",
    };
    const sentences = spans(typography.title, typography.body);
    const picked = Object.keys(sentences)[2];
    askJev.mockReset();
    askJev.mockResolvedValueOnce(judgeAnswers([{ quote: picked }]));
    const judged = await judgeItems("project-1", product, [typography]);
    expect(judged[0].needEvidence).toEqual({ quote: sentences[picked] });
    expect(judged[0].needEvidence?.quote).toContain("it's got to take");
    expect(judged[0].decision).toBe("qualify");
  });

  it("leaves a lead no sentence speaks for with no evidence, and holds it for review", async () => {
    askJev.mockReset();
    askJev.mockResolvedValueOnce(judgeAnswers([{ quote: "none" }]));
    const judged = await judgeItems("project-1", product, [item]);
    expect(judged[0].needEvidence).toBeNull();
    expect(judged[0].decision).toBe("review");
    expect(judged[0].reasonCode).toBe("insufficient_evidence");
  });

  it("never offers a commenter the words of the post they are answering", () => {
    const sentences = Object.values(spans(commenter.title, commenter.body));
    expect(sentences.some((one) => one.includes("it has to take payments"))).toBe(false);
    expect(itemState(commenter).parent_post_replied_to).toContain("it has to take payments");
  });

  it("holds a commenter whose only quote comes from the post they are answering", async () => {
    askJev.mockReset();
    askJev.mockResolvedValueOnce(judgeAnswers([{}]));
    const judged = await judgeItems(
      "project-1",
      product,
      [commenter],
      new Map([
        [
          "c1",
          {
            relationship: "buyer" as const,
            needState: "open" as const,
            quote: "it has to take payments",
          },
        ],
      ]),
    );
    expect(judged[0].decision).toBe("review");
    expect(judged[0].reasonCode).toBe("insufficient_evidence");
  });
});

describe("body truncation", () => {
  it("keeps the head and the tail, where the edit and the resolution live", () => {
    const body = `${"a".repeat(BODY_CHAR_BUDGET)}Edit: solved, we bought one.`;
    const kept = truncateBody(body);
    expect(kept.startsWith("aaaa")).toBe(true);
    expect(kept).toContain("Edit: solved, we bought one.");
    expect(kept.length).toBeLessThan(body.length);
  });

  it("leaves a short body alone", () => {
    expect(truncateBody("short")).toBe("short");
  });
});

describe("triage", () => {
  const candidates = [
    { id: "a", title: "A", subreddit: "SaaS", author: null, score: null, ageHours: 1 },
    { id: "b", title: "B", subreddit: "SaaS", author: null, score: null, ageHours: 1 },
    { id: "c", title: "C", subreddit: "SaaS", author: null, score: null, ageHours: 1 },
  ];

  it("reads the likeliest asker first and keeps the unsure one in the queue", async () => {
    askJev.mockReset();
    askJev.mockResolvedValueOnce(
      triageAnswers([{ asking: 0.2 }, { asking: 0.9 }, { asking: 0.6 }]),
    );
    const triage = await triageTitles("project-1", product, candidates);
    expect(triage.map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(triage[0].disposition).toBe("uncertain");
    expect(readOrder(triage, new Map())).toEqual(["b", "c", "a"]);
  });

  it("reads more titles than one batch holds, keeping every id and the ranking", async () => {
    const many = Array.from({ length: TRIAGE_BATCH_SIZE + 5 }, (_, index) => ({
      id: `p${index}`,
      title: `Title ${index}`,
      subreddit: "SaaS",
      author: null,
      score: null,
      ageHours: 1,
    }));
    const last = `Title ${TRIAGE_BATCH_SIZE - 1}`;
    const first = `Title ${TRIAGE_BATCH_SIZE}`;
    askJev.mockReset();
    askJev.mockImplementation(async (call: { state: { titles: Record<string, { title: string }> } }) =>
      triageAnswers(
        Object.values(call.state.titles).map((title) => ({
          asking: title.title === last || title.title === first ? 0.9 : 0.6,
        })),
      ),
    );

    const triage = await triageTitles("project-1", product, many);

    expect(askJev).toHaveBeenCalledTimes(2);
    const asked = (index: number) =>
      Object.values(
        askJev.mock.calls[index][0].state.titles as Record<string, { title: string }>,
      ).map((title) => title.title);
    expect(asked(0)).toContain("Title 0");
    expect(asked(0)).not.toContain(first);
    expect(triage).toHaveLength(many.length);
    expect(new Set(triage.map((one) => one.id)).size).toBe(many.length);
    expect(triage.every((one) => one.disposition === "read")).toBe(true);
    const order = readOrder(triage, new Map());
    expect(order.slice(0, 2)).toEqual([`p${TRIAGE_BATCH_SIZE - 1}`, `p${TRIAGE_BATCH_SIZE}`]);
    expect(order.slice(2)).toEqual(
      many
        .map((one) => one.id)
        .filter((id) => id !== `p${TRIAGE_BATCH_SIZE - 1}` && id !== `p${TRIAGE_BATCH_SIZE}`),
    );
  });

  it("reads the uncertain, never the rejected", () => {
    const triage: TriageItem[] = [
      { id: "a", disposition: "reject", asking: 0.9 },
      { id: "b", disposition: "uncertain", asking: 0.1 },
    ];
    expect(readOrder(triage, new Map())).toEqual(["b"]);
  });
});

describe("what one scan may buy", () => {
  it("opens no more posts than the tier's hydration budget", () => {
    expect(hydrationCap(TIERS.free)).toBe(TIERS.free.hydrationPerScan);
    expect(hydrationCap(TIERS.connected)).toBe(TIERS.connected.hydrationPerScan);
  });

  it("caps nothing for a self-hosted instance, which retrieves like a connected one", () => {
    expect(hydrationCap(null)).toBeNull();
    expect(retrievalBudgets(null)).toEqual(retrievalBudgets(TIERS.connected));
  });

  it("reads every budget from the tier", () => {
    expect(retrievalBudgets(TIERS.free)).toEqual({
      searches: TIERS.free.searchesPerScan,
      scoped: TIERS.free.scopedSearchesPerScan,
      listings: TIERS.free.listingPilotsPerScan,
      serpPerDay: TIERS.free.serpQueriesPerDay,
      pages: TIERS.free.searchPagesPerQuery,
    });
  });
});

describe("retention cutoff", () => {
  it("keeps exactly the feed window", () => {
    const now = new Date("2026-09-05T00:00:00Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  it("matches the tier feed window", () => {
    const now = new Date("2026-09-05T00:00:00Z");
    const days = (now.getTime() - retentionCutoff(now).getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(TIERS.free.feedWindowDays);
  });
});
