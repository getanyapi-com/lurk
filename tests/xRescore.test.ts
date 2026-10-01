import { beforeEach, expect, it, vi } from "vitest";
import type { Question } from "@/lib/jev";
import { describeDb, makeProject, makeUser, newId } from "./fixtures/db";

/**
 * A screened post gets one quick read afterwards, only so Filtered out can
 * rank it: it stays screened, keeps its rule, and is never a lead.
 */

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));
vi.mock("@/lib/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jev")>()),
  askJev,
}));

/** Every question answered as a buyer would, so a gate would qualify the post if it were read as a candidate. */
function buyer(call: { questions: Record<string, Question> }) {
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(call.questions)) {
    if (question.type === "noul") {
      const yes = ["own_need", "same_kind", "can_use", "wants_offering", "audience", "is_lead_like"].includes(key);
      answers[key] = { type: "noul", noul: yes ? 0.9 : 0.1 };
    } else if (question.type === "score") {
      answers[key] = { type: "score", score: 3 };
    } else {
      answers[key] = { type: "choice", choice: key === "need_quote" ? "s0" : Object.keys(question.criteria)[0] };
    }
  }
  return answers;
}

describeDb("scoring what the free screen set aside", () => {
  beforeEach(() => {
    askJev.mockReset();
    askJev.mockImplementation(async (call) => buyer(call));
  });

  it("scores screened posts without moving them, and skips the rules a score cannot help with", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { scoreScreened } = await import("@/lib/x/rescore");
    const { loadScanProject } = await import("@/lib/scan/project");
    const user = await makeUser();
    const project = await makeProject(user.id, { name: "Clipy", url: "https://clipy.example", pain: "Recording demos", solution: "A screen recorder" });
    const rows: Record<string, string> = {};
    for (const [name, rule] of Object.entries({ noMatch: "no_visible_term:loom", stale: "stale", farm: "reply_farm" })) {
      const id = newId("7");
      const text = `any good loom alternative? ${name}`;
      await db().insert(schema.xPosts).values({ id, text, createdAt: new Date(), authorUsername: `a${id.slice(-8)}` });
      // The farm reply's thread was walked (trackPitchThread) and X no longer serves the post it answers.
      const context = name === "farm" ? { replyingTo: ["op"], selfThread: [], chainIncomplete: true, text } : null;
      const [row] = await db()
        .insert(schema.xEvaluations)
        .values({ projectId: project.id, tweetId: id, stage: "free_rejected", freeReject: rule, context })
        .returning();
      rows[name] = row.id;
    }

    const product = (await loadScanProject(project.id))!.product;
    expect(await scoreScreened(project.id, product)).toBe(2);
    const after = await db().select().from(schema.xEvaluations).where(eq(schema.xEvaluations.projectId, project.id));
    const byId = new Map(after.map((row) => [row.id, row]));
    for (const name of ["noMatch", "farm"]) {
      expect(byId.get(rows[name])).toMatchObject({ stage: "free_rejected", decision: null, reasonCode: null });
      expect(byId.get(rows[name])?.score).toBeGreaterThan(0);
    }
    expect(byId.get(rows.noMatch)?.freeReject).toBe("no_visible_term:loom");
    // An incomplete chain holds a lead back, not this read: the reason still says what the post wants.
    expect(byId.get(rows.farm)?.reason).toMatch(/^Wants what this product does/);
    expect(byId.get(rows.stale)?.score).toBeNull();
    expect(await db().select().from(schema.xLeads).where(eq(schema.xLeads.projectId, project.id))).toEqual([]);
    // Recorded apart from the judge's reads, so it never spends the day's judged allowance.
    expect(askJev.mock.calls.map(([call]) => call.purpose)).toEqual(["x_rescore", "x_rescore"]);
    // Scored once: a second pass finds nothing left to read.
    expect(await scoreScreened(project.id, product)).toBe(0);
  });
});
