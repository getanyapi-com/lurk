import { expect, it } from "vitest";
import { db } from "@/db";
import { handledThreads, leadMutes, llmUsage, xEvaluations, xLeads, xPosts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { markThreadReplied, reopenThread } from "@/lib/handled";
import { listXOpportunities, xEvaluationEntry, xEvaluationReplied, xOpportunityCard } from "@/lib/x/read";
import { xEvaluationConversation } from "@/lib/x/write";
import { describeDb, makeProject, makeUser, newId } from "./fixtures/db";

const good = {
  own_need: { type: "noul", noul: 0.95 }, same_kind: { type: "noul", noul: 0.9 },
  intent: { type: "score", score: 3 }, rival_vendor: { type: "noul", noul: 0.05 }, promoting: { type: "noul", noul: 0.05 }, resolved: { type: "noul", noul: 0.05 },
  hard_requirement: { type: "choice", choice: "unknown" },
};

describeDb("the ranked X window", () => {
  async function fixture() {
    const user = await makeUser();
    return makeProject(user.id, { leadFilters: { mustMention: ["recorder"], xMinScore: 80 } });
  }
  async function add(projectId: string, name: string, options: {
    stage?: string; level?: string; ageDays?: number; gone?: boolean; signals?: unknown; text?: string;
    status?: string; leadScore?: number; conversationId?: string; author?: string; reasonCode?: string; kind?: string;
  } = {}) {
    const id = newId("8");
    await db().insert(xPosts).values({ id, text: options.text ?? `${name} recorder`, createdAt: new Date(Date.now() - (options.ageDays ?? 1) * 86_400_000),
      authorUsername: options.author ?? `author${id}`, unavailableAt: options.gone ? new Date() : null, conversationId: options.conversationId });
    await db().insert(xEvaluations).values({ projectId, tweetId: id, stage: options.stage ?? "free_rejected", freeReject: "no_visible_term", score: 65,
      level: options.level ?? "search", reasonCode: options.reasonCode, signals: options.signals === undefined ? good : options.signals, engagement: 3 });
    if (options.status) await db().insert(xLeads).values({ projectId, tweetId: id, status: options.status, kind: options.kind ?? "ask", score: options.leadScore ?? 90,
      authorUsername: options.author ?? `author${id}`, conversationId: options.conversationId ?? id });
    return id;
  }

  it("can surface screened and pending-context requests without promoting, alerting or buying anything", async () => {
    const project = await fixture();
    const screened = await add(project.id, "older strong", { ageDays: 5 });
    const pending = await add(project.id, "pending", { stage: "pending_context", author: "another" });
    await add(project.id, "new seller", { ageDays: 0, signals: { ...good, rival_vendor: { type: "noul", noul: 0.99 } } });
    const feed = await listXOpportunities(project.id, { days: 7, status: "new" });
    expect(feed.items.slice(0, 2).map((x) => xOpportunityCard(x.entry).tweetId)).toEqual([pending, screened]);
    expect(feed.items[0].entry.kind).toBe("held");
    expect(feed.items[1]).toMatchObject({ entry: { kind: "filtered", item: { kind: "screened" } }, checks: ["Check author and context", "Check requirements"] });
    const [stored] = await db().select().from(xEvaluations).where(and(eq(xEvaluations.projectId, project.id), eq(xEvaluations.tweetId, screened)));
    expect(stored).toMatchObject({ stage: "free_rejected", score: 65 });
    expect(await db().select().from(xLeads).where(eq(xLeads.projectId, project.id))).toHaveLength(0);
    expect(await db().select().from(llmUsage).where(eq(llmUsage.projectId, project.id))).toHaveLength(0);
  });

  it("honours project/date filters, mutes, deletions and handled threads; hidden leads cannot return through evaluations", async () => {
    const project = await fixture();
    const wanted = await add(project.id, "wanted");
    const hidden = await add(project.id, "hidden", { stage: "lead", status: "hidden" });
    await add(project.id, "low legacy score", { stage: "lead", status: "new", leadScore: 70 });
    await add(project.id, "gone", { gone: true });
    await add(project.id, "old", { ageDays: 9 });
    await add(project.id, "missing keyword", { text: "unrelated form request" });
    await add(project.id, "muted", { text: "muteme recorder" });
    await db().insert(leadMutes).values({ projectId: project.id, kind: "keyword", value: "muteme" });
    await add(project.id, "answered sibling", { conversationId: "answered" });
    await db().insert(handledThreads).values({ projectId: project.id, platform: "x", threadId: "answered" });
    const other = await fixture(); await add(other.id, "other project");
    const feed = await listXOpportunities(project.id, { days: 7, status: "new" });
    expect(feed.items.map((x) => xOpportunityCard(x.entry).tweetId)).toEqual([wanted]);
    const history = await listXOpportunities(project.id, { days: 7, status: "hidden" });
    expect(history.items.map((x) => xOpportunityCard(x.entry).tweetId)).toEqual([hidden]);
  });

  it("does not cap by recency or pipeline bucket before ranking", async () => {
    const project = await fixture();
    const strong = await add(project.id, "old strong", { ageDays: 5 });
    const ids = Array.from({ length: 205 }, () => newId("8"));
    await db().insert(xPosts).values(ids.map((id) => ({ id, text: "recorder promotion", createdAt: new Date(), authorUsername: `p${id}` })));
    await db().insert(xEvaluations).values(ids.map((id) => ({ projectId: project.id, tweetId: id, stage: "review", level: "complete",
      signals: { ...good, promoting: { type: "noul", noul: 0.99 } }, engagement: 3 })));
    // Unscored, so last: below the cap, on a day no listed card is from.
    const unlisted = await add(project.id, "unscored", { ageDays: 3, signals: null });
    const feed = await listXOpportunities(project.id, { days: 7, status: "new" });
    expect(feed.items).toHaveLength(200);
    expect(feed.total).toBe(207);
    expect(xOpportunityCard(feed.items[0].entry).tweetId).toBe(strong);
    // The date strip is drawn from the whole ranked window, not the listed 200.
    expect(feed.faces).toHaveLength(207);
    const [evaluation] = await db().select().from(xEvaluations).where(and(eq(xEvaluations.projectId, project.id), eq(xEvaluations.tweetId, unlisted)));
    expect(feed.items.some((item) => xOpportunityCard(item.entry).tweetId === unlisted)).toBe(false);
    expect(feed.faces.find((face) => face.id === `filtered-${evaluation.id}`)?.at.getTime()).toBeLessThan(Date.now() - 2 * 86_400_000);
  });

  it("ranks the evidence of a post the legacy score merged away, one card per author, unless their lead there was acted on", async () => {
    const project = await fixture();
    const weak = { ...good, own_need: { type: "noul", noul: 0.1 } };
    const lead = await add(project.id, "legacy winner", { stage: "lead", status: "new", author: "dup", conversationId: "c1", signals: weak, ageDays: 0 });
    const merged = await add(project.id, "merged sibling", { stage: "merged", level: "complete", author: "dup", conversationId: "c1", ageDays: 2 });
    let feed = await listXOpportunities(project.id, { days: 7, status: "new" });
    expect(feed.items.map((x) => xOpportunityCard(x.entry).tweetId)).toEqual([merged]);
    expect(feed.items[0].entry.kind).toBe("held");
    expect(feed.total).toBe(1);
    const [evaluation] = await db().select().from(xEvaluations).where(and(eq(xEvaluations.projectId, project.id), eq(xEvaluations.tweetId, merged)));
    expect((await xEvaluationEntry(project.id, evaluation.id))?.kind).toBe("held");
    // A merged post stays merged: ranking writes nothing.
    expect(evaluation.stage).toBe("merged");
    for (const status of ["hidden", "not_fit", "replied"]) {
      await db().update(xLeads).set({ status }).where(and(eq(xLeads.projectId, project.id), eq(xLeads.tweetId, lead)));
      feed = await listXOpportunities(project.id, { days: 7, status: "new" });
      expect(feed.items).toEqual([]);
    }
  });

  it("marks a ranked post that is not a lead replied by its conversation, without writing a lead", async () => {
    const project = await fixture();
    const screened = await add(project.id, "screened", { conversationId: "c2" });
    const [evaluation] = await db().select().from(xEvaluations).where(and(eq(xEvaluations.projectId, project.id), eq(xEvaluations.tweetId, screened)));
    expect(await xEvaluationReplied(project.id, evaluation.id)).toBe(false);
    const conversation = await xEvaluationConversation(project.id, evaluation.id);
    expect(conversation).toBe("c2");
    await markThreadReplied(project.id, "x", conversation!);
    expect(await xEvaluationReplied(project.id, evaluation.id)).toBe(true);
    expect((await listXOpportunities(project.id, { days: 7, status: "new" })).items).toEqual([]);
    expect(await db().select().from(xLeads).where(eq(xLeads.projectId, project.id))).toHaveLength(0);
    await reopenThread(project.id, "x", conversation!);
    expect((await listXOpportunities(project.id, { days: 7, status: "new" })).items).toHaveLength(1);
    const other = await fixture();
    expect(await xEvaluationConversation(other.id, evaluation.id)).toBeNull();
  });

  it("uses the persisted final reply verdict, not a raw positive, independently of buyer-only signals", async () => {
    const project = await fixture();
    const signals = { ...good, own_need: null, intent: null, promoting: null, resolved: null,
      founder_would_reply: { type: "noul", noul: 0.98 }, reply: { worth_reply: true } };
    const stored = { stage: "reply", status: "new", kind: "reply", signals };
    const positive = await add(project.id, "checked venue", { ...stored, reasonCode: "worth_reply" });
    const rawOnly = await add(project.id, "raw model positive", stored);
    const failed = await add(project.id, "failed quote check", { ...stored, reasonCode: "worth_reply",
      signals: { ...signals, reply: { worth_reply: true, code: "not_reply_worthy" } } });
    const feed = await listXOpportunities(project.id, { days: 7, status: "new" });
    const cards = new Map(feed.items.map((item) => [xOpportunityCard(item.entry).tweetId, item]));
    expect(cards.get(positive)?.priority).toBeCloseTo(0.5 * 0.98 * 0.9 * 0.95);
    expect(cards.get(positive)?.checks).toEqual(["Check requirements", "Adoption assessment incomplete"]);
    expect(cards.get(rawOnly)?.priority).toBeNull();
    expect(cards.get(failed)?.priority).toBeNull();
    expect(cards.get(failed)?.checks).toContain("Public reply not recommended");
    expect(await db().select().from(llmUsage).where(eq(llmUsage.projectId, project.id))).toHaveLength(0);
  });
});
