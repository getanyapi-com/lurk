import { expect, it } from "vitest";
import { db } from "@/db";
import { handledThreads, leadMutes, llmUsage, xEvaluations, xLeads, xPosts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { listXOpportunities, xOpportunityCard } from "@/lib/x/read";
import { describeDb, makeProject, makeUser, newId } from "./fixtures/db";

const good = {
  own_need: { type: "noul", noul: 0.95 }, same_kind: { type: "noul", noul: 0.9 }, supported_job: { type: "noul", noul: 0.9 },
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
    status?: string; leadScore?: number; conversationId?: string; author?: string;
  } = {}) {
    const id = newId("8");
    await db().insert(xPosts).values({ id, text: options.text ?? `${name} recorder`, createdAt: new Date(Date.now() - (options.ageDays ?? 1) * 86_400_000),
      authorUsername: options.author ?? `author${id}`, unavailableAt: options.gone ? new Date() : null, conversationId: options.conversationId });
    await db().insert(xEvaluations).values({ projectId, tweetId: id, stage: options.stage ?? "free_rejected", freeReject: "no_visible_term", score: 65,
      level: options.level ?? "search", signals: options.signals === undefined ? good : options.signals, engagement: 3 });
    if (options.status) await db().insert(xLeads).values({ projectId, tweetId: id, status: options.status, score: options.leadScore ?? 90, authorUsername: `author${id}` });
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
    const feed = await listXOpportunities(project.id, { days: 7, status: "new" });
    expect(feed.items).toHaveLength(200);
    expect(feed.total).toBe(206);
    expect(xOpportunityCard(feed.items[0].entry).tweetId).toBe(strong);
  });
});
