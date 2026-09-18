import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one job a new project starts with, and what it leaves behind. Everything
 * a person waits for after pressing Create is queued here, in one transaction
 * with the marker that says the project is set up, so a crash in the middle
 * leaves a project that is still owed its setup rather than one that silently
 * never gets scanned.
 */

const runDiscovery = vi.fn();
const resolveActiveSubreddits = vi.fn(async () => ["saas"]);

vi.mock("@/lib/discovery/run", () => ({
  runDiscovery,
  discoveryBudget: () => ({ refreshDays: 7 }),
}));
vi.mock("@/lib/profile", () => ({ resolveActiveSubreddits }));

const HOUR_MS = 60 * 60 * 1000;

async function fixture(discovered: Date | null = null) {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const [user] = await db()
    .insert(schema.users)
    .values({ clerkUserId: `test_${randomUUID()}` })
    .returning();
  const [project] = await db()
    .insert(schema.projects)
    .values({
      userId: user.id,
      name: "Formcraft",
      pain: "Forms cannot branch.",
      solution: "A form builder with conditional logic.",
      targetUsers: "Ops teams",
      capabilities: ["branching"],
      problemPhrasings: ["forms that branch"],
      discoveredAt: discovered,
    })
    .returning();
  return { db, schema, user, project };
}

describe.skipIf(!process.env.DATABASE_URL)("the initial discovery", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    process.env.SELF_HOSTED = "false";
    runDiscovery.mockClear();
    resolveActiveSubreddits.mockClear();
  });

  it("publishes a plan, reads the communities, and books every first job once", async () => {
    const { db, schema, user, project } = await fixture();
    const { eq } = await import("drizzle-orm");
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const job = { id: undefined, projectId: project.id } as unknown as Parameters<
      (typeof JOB_HANDLERS)["discovery_initial"]
    >[0];

    await JOB_HANDLERS.discovery_initial(job);

    expect(runDiscovery).toHaveBeenCalledTimes(1);
    expect(runDiscovery.mock.calls[0][0]).toMatchObject({
      projectId: project.id,
      userId: user.id,
      facts: { name: "Formcraft", pain: "Forms cannot branch.", capabilities: ["branching"] },
      problemPhrasings: ["forms that branch"],
    });
    expect(resolveActiveSubreddits).toHaveBeenCalledWith(project.id, user.id);

    const [marked] = await db()
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(marked.discoveredAt).not.toBeNull();

    const queued = async () =>
      db().select().from(schema.jobs).where(eq(schema.jobs.projectId, project.id));
    const first = await queued();
    expect(first.map((row) => row.kind).sort()).toEqual([
      "backfill",
      "competitor_scan",
      "discovery_refresh",
      "scan",
      "seo_refresh",
    ]);
    const due = (kind: string) =>
      (first.find((row) => row.kind === kind)!.runAt.getTime() - Date.now()) / HOUR_MS;
    expect(due("backfill")).toBeLessThan(0.1);
    expect(due("seo_refresh")).toBeLessThan(0.1);
    expect(due("competitor_scan")).toBeLessThan(0.1);
    expect(due("scan")).toBeGreaterThan(5);
    expect(due("discovery_refresh")).toBeGreaterThan(24);

    await JOB_HANDLERS.discovery_initial(job);
    expect((await queued()).map((row) => row.kind).sort()).toEqual(
      first.map((row) => row.kind).sort(),
    );
  });

  it("books the first sweep before it reads a single community's rules", async () => {
    const { db, schema, project } = await fixture();
    const { eq } = await import("drizzle-orm");
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    let bookedWhenRulesWereRead: string[] = [];
    resolveActiveSubreddits.mockImplementationOnce(async () => {
      const rows = await db().select().from(schema.jobs).where(eq(schema.jobs.projectId, project.id));
      bookedWhenRulesWereRead = rows.map((row) => row.kind);
      return ["saas"];
    });
    const job = { id: undefined, projectId: project.id } as unknown as Parameters<
      (typeof JOB_HANDLERS)["discovery_initial"]
    >[0];

    await JOB_HANDLERS.discovery_initial(job);

    expect(bookedWhenRulesWereRead).toContain("backfill");
  });

  it("comes back on the same cadence a failed first sweep does, not days later", async () => {
    const { db, schema, project } = await fixture();
    const { and, eq, isNull } = await import("drizzle-orm");
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const { runClaimedJob } = await import("@/jobs/runner");

    const [claimed] = await db()
      .insert(schema.jobs)
      .values({ kind: "discovery_initial", projectId: project.id, startedAt: new Date() })
      .returning();
    const original = JOB_HANDLERS.discovery_initial;
    JOB_HANDLERS.discovery_initial = async () => {
      throw new Error("Google returned 502");
    };
    try {
      await runClaimedJob(claimed);
    } finally {
      JOB_HANDLERS.discovery_initial = original;
    }

    const pending = await db()
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "discovery_initial"),
          eq(schema.jobs.projectId, project.id),
          isNull(schema.jobs.startedAt),
        ),
      );
    expect(pending).toHaveLength(1);
    const { cadenceFor } = await import("@/lib/settings/cadence");
    const { PRESETS } = await import("@/lib/settings/presets");
    const due = cadenceFor(PRESETS.free.cadence).nextRunAt(new Date()).getTime();
    expect(pending[0].runAt.getTime()).toBeCloseTo(due, -4);
  });
});
