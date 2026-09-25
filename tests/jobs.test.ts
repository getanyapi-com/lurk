import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueOnce } from "@/jobs/enqueue";
import { JOB_HANDLERS, nextRunAt, type Job } from "@/jobs/registry";
import { runBackfill } from "@/lib/scan/backfill";
import { runScan } from "@/lib/scan/run";
import { captureRequestId, withRequestId } from "@/lib/anyapi";
import { HEARTBEAT_MS, LEASE_MS } from "@/jobs/lease";
import { isTransient, reasonFor, TRANSIENT_RETRY_MS } from "@/jobs/runner";
import { LlmTimeoutError, LLM_CALL_TIMEOUT_MS, withCallTimeout } from "@/lib/llm";
import { cadenceFor } from "@/lib/settings/cadence";
import { PRESETS } from "@/lib/settings/presets";

/** When a failed job of a free user is due again: its own cadence, not sooner. */
function nextFreeScan(): Date {
  return cadenceFor(PRESETS.free.cadence).nextRunAt(new Date());
}

/**
 * The scan itself is not under test here, only what the registry does with what
 * it returns. enqueueOnce keeps its real behaviour so the queue tests below
 * still re-queue for real; the wiring suite at the end of this file replaces it.
 */
vi.mock("@/lib/scan/run", () => ({ runScan: vi.fn() }));
vi.mock("@/lib/scan/backfill", () => ({ runBackfill: vi.fn() }));
vi.mock("@/jobs/enqueue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/enqueue")>();
  return { ...actual, enqueueOnce: vi.fn(actual.enqueueOnce) };
});

describe("request identity", () => {
  it("gives each call its own request id and never the previous one", async () => {
    const withHeader = await withRequestId(async () => {
      captureRequestId(new Response(null, { headers: { "x-anyapi-request-id": "req-1" } }));
      return "first";
    });
    const withoutHeader = await withRequestId(async () => {
      captureRequestId(new Response(null));
      return "second";
    });

    expect(withHeader).toEqual({ result: "first", requestId: "req-1" });
    expect(withoutHeader).toEqual({ result: "second", requestId: null });
  });

  it("keeps two calls in flight at once apart", async () => {
    const slow = withRequestId(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      captureRequestId(new Response(null, { headers: { "x-anyapi-request-id": "slow" } }));
      return "slow";
    });
    const fast = await withRequestId(async () => {
      captureRequestId(new Response(null, { headers: { "x-anyapi-request-id": "fast" } }));
      return "fast";
    });

    expect(fast.requestId).toBe("fast");
    expect((await slow).requestId).toBe("slow");
  });
});

describe("what a failed job records", () => {
  it("keeps the whole chain, because the wrapper's message is only the query", () => {
    const cause = Object.assign(new Error("ON CONFLICT DO UPDATE command cannot affect row"), {
      code: "21000",
    });
    const wrapper = new Error("Failed query: insert into \"lead_evaluations\"", { cause });

    expect(reasonFor(wrapper)).toBe(
      'Failed query: insert into "lead_evaluations"; ON CONFLICT DO UPDATE command cannot affect row; code 21000',
    );
  });

  it("names the row a foreign key rejected, which only the detail says", () => {
    const cause = Object.assign(new Error("violates foreign key constraint"), {
      code: "23503",
      detail: "Key (comment_id)=(abc) is not present in table \"reddit_comments\".",
    });

    expect(reasonFor(new Error("Failed query: insert", { cause }))).toContain(
      'detail Key (comment_id)=(abc) is not present in table "reddit_comments".',
    );
  });

  it("drops the NUL a rejected model quote leaves in the driver's complaint", () => {
    const cause = Object.assign(new Error("invalid byte sequence for encoding UTF8: 0x00"), {
      code: "22021",
      detail: "the quote said it\u0000s free",
    });
    const reason = reasonFor(new Error("Failed query: insert into \"jobs\"", { cause }));

    expect(reason).not.toContain("\u0000");
    expect(reason).toContain("detail the quote said its free");
  });

  it("leaves an error that carries no cause exactly as it reads", () => {
    expect(reasonFor(new LlmTimeoutError(LLM_CALL_TIMEOUT_MS))).toBe(
      new LlmTimeoutError(LLM_CALL_TIMEOUT_MS).message,
    );
    expect(reasonFor("not an error at all")).toBe("not an error at all");
  });
});

describe("which failures are worth running again", () => {
  it("counts a full database, however deep in the chain, as passing", () => {
    const full = Object.assign(
      new Error("remaining connection slots are reserved for roles with the SUPERUSER attribute"),
      { code: "53300" },
    );
    expect(isTransient(new Error("Failed query: select", { cause: full }))).toBe(true);
    expect(isTransient(Object.assign(new Error("closed"), { code: "CONNECTION_CLOSED" }))).toBe(
      true,
    );
  });

  it("does not count a statement Postgres rejected on its merits", () => {
    const conflict = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(isTransient(new Error("Failed query: insert", { cause: conflict }))).toBe(false);
    expect(isTransient(new Error("Reddit returned 502"))).toBe(false);
    expect(isTransient("not an error")).toBe(false);
  });
});

describe("the model call deadline", () => {
  it("cuts a call off well inside the lease it must not outlive", () => {
    expect(LLM_CALL_TIMEOUT_MS).toBe(HEARTBEAT_MS);
    expect(LLM_CALL_TIMEOUT_MS).toBeLessThan(LEASE_MS);
  });

  it("turns a call that never answers into a plain failure", async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });

    await expect(withCallTimeout(hang, 5)).rejects.toThrow(/did not answer within/);
    expect(new LlmTimeoutError(LLM_CALL_TIMEOUT_MS).message).toBe(
      "The language model did not answer within 3 minutes. The scan stopped and will run again.",
    );
  });

  it("lets a call that answers in time through untouched", async () => {
    await expect(withCallTimeout(async () => "answer", 1000)).resolves.toBe("answer");
  });
});

/**
 * The queue's invariants are SQL, so they are proven against a real database.
 * Every test row is dated 2000 and every claim is made as of NOW, also in 2000,
 * so no row this instance already holds is due and none of them are touched.
 */
describe.skipIf(!process.env.DATABASE_URL)("the job queue against a database", () => {
  const LONG_AGO = new Date("2000-01-01T00:00:00Z");
  const NOW = new Date("2000-01-01T01:00:00Z");

  /** Rows a previous run left behind are the only jobs this old. */
  beforeAll(async () => {
    const { db } = await import("@/db");
    const { jobs } = await import("@/db/schema");
    const { lt } = await import("drizzle-orm");
    await db().delete(jobs).where(lt(jobs.runAt, new Date("2001-01-01T00:00:00Z")));
  });

  async function fixture() {
    const { db } = await import("@/db");
    const { jobs, projects, users } = await import("@/db/schema");
    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Queue test" })
      .returning();
    return { db, jobs, projects, users, user, project };
  }

  it("re-queues a scan whose run failed, and records the reason not a stack", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const { runClaimedJob } = await import("@/jobs/runner");
    const { and, eq, isNull } = await import("drizzle-orm");

    const [claimed] = await db()
      .insert(jobs)
      .values({ kind: "scan", projectId: project.id, runAt: LONG_AGO, startedAt: new Date() })
      .returning();
    const original = JOB_HANDLERS.scan;
    const selfHosted = process.env.SELF_HOSTED;
    process.env.SELF_HOSTED = "false";
    JOB_HANDLERS.scan = async () => {
      throw new Error("Reddit returned 502");
    };
    try {
      await runClaimedJob(claimed);
    } finally {
      JOB_HANDLERS.scan = original;
      if (selfHosted === undefined) {
        delete process.env.SELF_HOSTED;
      } else {
        process.env.SELF_HOSTED = selfHosted;
      }
    }

    const [finished] = await db().select().from(jobs).where(eq(jobs.id, claimed.id));
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.error).toBe("Reddit returned 502");

    const pending = await db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, "scan"), eq(jobs.projectId, project.id), isNull(jobs.startedAt)));
    expect(pending).toHaveLength(1);
    expect(pending[0].runAt.getTime()).toBeCloseTo(nextFreeScan().getTime(), -4);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("hands a setup that lost its database connection back to run again, unfinished", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const { runClaimedJob } = await import("@/jobs/runner");
    const { eq } = await import("drizzle-orm");

    const [claimed] = await db()
      .insert(jobs)
      .values({
        kind: "discovery_initial",
        projectId: project.id,
        runAt: LONG_AGO,
        startedAt: new Date(),
      })
      .returning();
    const original = JOB_HANDLERS.discovery_initial;
    JOB_HANDLERS.discovery_initial = async () => {
      const full = Object.assign(new Error("remaining connection slots are reserved"), {
        code: "53300",
      });
      throw new Error("Failed query: select 1", { cause: full });
    };
    const before = Date.now();
    try {
      await runClaimedJob(claimed);
    } finally {
      JOB_HANDLERS.discovery_initial = original;
    }

    const [row] = await db().select().from(jobs).where(eq(jobs.id, claimed.id));
    expect(row.finishedAt).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.error).toContain("code 53300");
    expect(row.runAt.getTime()).toBeGreaterThanOrEqual(before + TRANSIENT_RETRY_MS);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("re-queues a backfill that failed, and never one that finished", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const { runClaimedJob } = await import("@/jobs/runner");
    const { and, eq, isNull } = await import("drizzle-orm");

    const original = JOB_HANDLERS.backfill;
    const selfHosted = process.env.SELF_HOSTED;
    process.env.SELF_HOSTED = "false";
    const pendingBackfills = () =>
      db()
        .select()
        .from(jobs)
        .where(and(eq(jobs.kind, "backfill"), eq(jobs.projectId, project.id), isNull(jobs.startedAt)));
    try {
      const [failed] = await db()
        .insert(jobs)
        .values({ kind: "backfill", projectId: project.id, runAt: LONG_AGO, startedAt: new Date() })
        .returning();
      JOB_HANDLERS.backfill = async () => {
        throw new Error("The language model did not answer within 3 minutes");
      };
      await runClaimedJob(failed);
      const retried = await pendingBackfills();
      expect(retried).toHaveLength(1);
      expect(retried[0].runAt.getTime()).toBeCloseTo(nextFreeScan().getTime(), -4);
      await db().delete(jobs).where(eq(jobs.id, retried[0].id));

      const [done] = await db()
        .insert(jobs)
        .values({ kind: "backfill", projectId: project.id, runAt: LONG_AGO, startedAt: new Date() })
        .returning();
      JOB_HANDLERS.backfill = async () => {};
      await runClaimedJob(done);
      expect(await pendingBackfills()).toHaveLength(0);
    } finally {
      JOB_HANDLERS.backfill = original;
      if (selfHosted === undefined) {
        delete process.env.SELF_HOSTED;
      } else {
        process.env.SELF_HOSTED = selfHosted;
      }
    }

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("keeps advancing the lease of a job that is still running", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const { runClaimedJob } = await import("@/jobs/runner");
    const { eq } = await import("drizzle-orm");

    const stamp = new Date();
    const [claimed] = await db()
      .insert(jobs)
      .values({ kind: "noop", projectId: project.id, runAt: LONG_AGO, startedAt: stamp })
      .returning();
    const original = JOB_HANDLERS.noop;
    let advanced: Date | null = null;
    vi.useFakeTimers({ toFake: ["setInterval"] });
    JOB_HANDLERS.noop = async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      for (let attempt = 0; attempt < 100 && !advanced; attempt += 1) {
        const [row] = await db().select().from(jobs).where(eq(jobs.id, claimed.id));
        if (row.startedAt && row.startedAt.getTime() > stamp.getTime()) {
          advanced = row.startedAt;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    };
    try {
      await runClaimedJob(claimed);
    } finally {
      JOB_HANDLERS.noop = original;
      vi.useRealTimers();
    }

    expect(advanced).not.toBeNull();
    const [finished] = await db().select().from(jobs).where(eq(jobs.id, claimed.id));
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.error).toBeNull();

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("writes nothing once another worker has taken the job away", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const { runClaimedJob } = await import("@/jobs/runner");
    const { and, eq, isNull } = await import("drizzle-orm");

    const [claimed] = await db()
      .insert(jobs)
      .values({ kind: "scan", projectId: project.id, runAt: LONG_AGO, startedAt: new Date() })
      .returning();
    const original = JOB_HANDLERS.scan;
    JOB_HANDLERS.scan = async () => {
      await db()
        .update(jobs)
        .set({ startedAt: new Date(Date.now() + 1000) })
        .where(eq(jobs.id, claimed.id));
      throw new Error("Reddit returned 502");
    };
    try {
      await runClaimedJob(claimed);
    } finally {
      JOB_HANDLERS.scan = original;
    }

    const [row] = await db().select().from(jobs).where(eq(jobs.id, claimed.id));
    expect(row.finishedAt).toBeNull();
    expect(row.error).toBeNull();
    const pending = await db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, "scan"), eq(jobs.projectId, project.id), isNull(jobs.startedAt)));
    expect(pending).toHaveLength(0);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("reclaims a job whose lease expired and leaves a live one alone", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { claimNextJob } = await import("@/jobs/runner");
    const { eq } = await import("drizzle-orm");

    const [live] = await db()
      .insert(jobs)
      .values({
        kind: "noop",
        projectId: project.id,
        runAt: LONG_AGO,
        startedAt: new Date(NOW.getTime() - LEASE_MS / 2),
      })
      .returning();
    expect(await claimNextJob(NOW)).toBeNull();

    await db()
      .update(jobs)
      .set({ startedAt: new Date(NOW.getTime() - LEASE_MS - 1000) })
      .where(eq(jobs.id, live.id));
    const reclaimed = await claimNextJob(NOW);
    expect(reclaimed?.id).toBe(live.id);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("claims a new project's setup before an older routine scan, and either sort alone when asked", async () => {
    const { db, jobs, projects, users, user, project } = await fixture();
    const { claimNextJob } = await import("@/jobs/runner");
    const { eq } = await import("drizzle-orm");

    const [signup] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Signed up a moment ago" })
      .returning();
    const [routine] = await db()
      .insert(jobs)
      .values({ kind: "noop", projectId: project.id, runAt: LONG_AGO })
      .returning();
    const [setup] = await db()
      .insert(jobs)
      .values({ kind: "discovery_initial", projectId: signup.id, runAt: new Date(LONG_AGO.getTime() + 5000) })
      .returning();

    expect((await claimNextJob(NOW, "routine"))?.id).toBe(routine.id);
    await db().update(jobs).set({ startedAt: null }).where(eq(jobs.id, routine.id));
    expect((await claimNextJob(NOW))?.id).toBe(setup.id);
    expect(await claimNextJob(NOW, "watched")).toBeNull();

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("never claims a second job of a project that is already running one", async () => {
    const { db, jobs, projects, users, user, project } = await fixture();
    const { claimNextJob } = await import("@/jobs/runner");
    const { eq } = await import("drizzle-orm");

    const [other] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Other queue test" })
      .returning();
    await db()
      .insert(jobs)
      .values({ kind: "noop", projectId: project.id, runAt: LONG_AGO, startedAt: NOW });
    const [blocked] = await db()
      .insert(jobs)
      .values({ kind: "noop", projectId: project.id, runAt: new Date(LONG_AGO.getTime() + 1000) })
      .returning();
    const [free] = await db()
      .insert(jobs)
      .values({ kind: "noop", projectId: other.id, runAt: new Date(LONG_AGO.getTime() + 2000) })
      .returning();

    const claimed = await claimNextJob(NOW);
    expect(claimed?.id).not.toBe(blocked.id);
    expect(claimed?.id).toBe(free.id);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("holds a routine job of a project nobody attends, and runs it once somebody does", async () => {
    const { db, jobs, users, user, project } = await fixture();
    const { claimNextJob } = await import("@/jobs/runner");
    const { alerts, apiKeys, projects } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [scan] = await db()
      .insert(jobs)
      .values({ kind: "scan", projectId: project.id, runAt: LONG_AGO })
      .returning();
    const [setup] = await db()
      .insert(jobs)
      .values({ kind: "discovery_initial", projectId: project.id, runAt: new Date(LONG_AGO.getTime() + 1000) })
      .returning();

    // Never seen and no channel: the setup still runs, the scan waits.
    expect((await claimNextJob(NOW))?.id).toBe(setup.id);
    await db().delete(jobs).where(eq(jobs.id, setup.id));
    expect(await claimNextJob(NOW)).toBeNull();

    // Seen two days ago is not attended either.
    await db()
      .update(users)
      .set({ lastSeenAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000) })
      .where(eq(users.id, user.id));
    expect(await claimNextJob(NOW)).toBeNull();

    await db().update(users).set({ lastSeenAt: NOW }).where(eq(users.id, user.id));
    expect((await claimNextJob(NOW))?.id).toBe(scan.id);

    // An alert channel keeps a project running with nobody looking.
    await db().update(users).set({ lastSeenAt: null }).where(eq(users.id, user.id));
    const [alerting] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Alerts on" })
      .returning();
    await db()
      .insert(alerts)
      .values({ projectId: alerting.id, channel: "email", target: "a@example.com", cadence: "daily" });
    const [alerted] = await db()
      .insert(jobs)
      .values({ kind: "insights", projectId: alerting.id, runAt: LONG_AGO })
      .returning();
    expect((await claimNextJob(NOW))?.id).toBe(alerted.id);

    // So does an API key the owner called with inside the window.
    const [called] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Read over the API" })
      .returning();
    const [refresh] = await db()
      .insert(jobs)
      .values({ kind: "seo_refresh", projectId: called.id, runAt: LONG_AGO })
      .returning();
    expect(await claimNextJob(NOW)).toBeNull();
    await db()
      .insert(apiKeys)
      .values({ userId: user.id, hash: randomUUID(), name: "ci", prefix: "lk_", lastUsedAt: NOW });
    expect((await claimNextJob(NOW))?.id).toBe(refresh.id);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("stamps a visit at most every few minutes, and hands out work on the first", async () => {
    const { db, users, user } = await fixture();
    const { noteSeen } = await import("@/lib/auth");
    const { eq } = await import("drizzle-orm");
    const seenAt = async () =>
      (await db().select().from(users).where(eq(users.id, user.id)))[0].lastSeenAt;

    await noteSeen(user.id, NOW);
    expect(await seenAt()).toEqual(NOW);
    await noteSeen(user.id, new Date(NOW.getTime() + 60_000));
    expect(await seenAt()).toEqual(NOW);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    await noteSeen(user.id, later);
    expect(await seenAt()).toEqual(later);

    await db().delete(users).where(eq(users.id, user.id));
  });

  it("seeds a scan for a project that has been set up, and the setup for one that has not", async () => {
    const { db, jobs, projects, users, user, project } = await fixture();
    const { seedProjectScans } = await import("@/jobs/scheduler");
    const { eq, inArray } = await import("drizzle-orm");

    await db()
      .update(projects)
      .set({ discoveredAt: new Date(), briefProfileVersion: 1 })
      .where(eq(projects.id, project.id));
    const [unbriefed] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Made before briefs", discoveredAt: new Date() })
      .returning();
    const [fresh] = await db()
      .insert(projects)
      .values({ userId: user.id, name: "Never discovered" })
      .returning();
    // Both already search, so neither is owed the sweep's searches (tests/widenSearches.test.ts).
    const { projectKeywords } = await import("@/db/schema");
    await db()
      .insert(projectKeywords)
      .values([project.id, unbriefed.id].map((projectId) => ({ projectId, keyword: "forms" })));

    await seedProjectScans();

    const kinds = async (projectId: string) =>
      (await db().select().from(jobs).where(eq(jobs.projectId, projectId)))
        .map((row) => row.kind)
        .sort();
    // No SEO pass and no competitor scan: those wait for their tab to be opened.
    expect(await kinds(project.id)).toEqual(["discovery_refresh", "scan"]);
    expect(await kinds(fresh.id)).toEqual(["discovery_initial"]);
    // A project with no brief for its profile gets one, and the rescore waits for it.
    expect(await kinds(unbriefed.id)).toEqual(["brief", "discovery_refresh", "scan"]);

    // A project whose tab was opened has had one, and is owed the next.
    const ran = new Date();
    await db()
      .insert(jobs)
      .values({ kind: "seo_refresh", projectId: project.id, runAt: ran, startedAt: ran, finishedAt: ran });
    await seedProjectScans();
    expect((await kinds(project.id)).filter((kind) => kind === "seo_refresh")).toHaveLength(2);
    expect(await kinds(project.id)).not.toContain("competitor_scan");

    await db()
      .delete(jobs)
      .where(inArray(jobs.projectId, [project.id, fresh.id, unbriefed.id]));
    await db().delete(users).where(eq(users.id, user.id));
    // It walks every project in the test database, which other files leave behind.
  }, 60_000);
});

/**
 * Themes are grouped when the Insights tab is opened (see regroupOnOpen), not
 * after every scan: most were never read. This suite runs last: it leaves
 * enqueueOnce faked, which the database-backed queue tests above rely on being
 * real.
 */
describe("what a finished scan queues", () => {
  const booked = vi.mocked(enqueueOnce);
  const scan = vi.mocked(runScan);
  const job = { id: "job-1", projectId: "project-1" } as Parameters<
    (typeof JOB_HANDLERS)["scan"]
  >[0];

  beforeAll(() => {
    booked.mockImplementation(async () => {});
  });

  beforeEach(() => {
    booked.mockClear();
    scan.mockReset();
  });

  it("does not group the leads again, however many a scan wrote", async () => {
    scan.mockResolvedValue({ candidates: 9, read: 4, leads: 2, gaps: [] });

    await JOB_HANDLERS.scan(job);

    expect(booked).not.toHaveBeenCalled();
  });

  it("does not group what a first year sweep wrote either", async () => {
    vi.mocked(runBackfill).mockResolvedValue({ walks: 20, found: 500, judged: 500, leads: 7, cutShort: 0 });

    await JOB_HANDLERS.backfill(job);

    expect(booked).not.toHaveBeenCalled();
  });
});

/**
 * A recurring kind books its successor only when it succeeds, so the retry time
 * is the only thing standing between one upstream error and a schedule that
 * never runs again. Every kind that recurs must have one.
 */
describe.skipIf(!process.env.DATABASE_URL)("when a failed recurring job is due again", () => {
  const job = (kind: string, projectId: string | null): Job =>
    ({ id: randomUUID(), kind, projectId }) as Job;

  it("gives every recurring kind a retry time, and a one-off kind none", async () => {
    const projectId = randomUUID();
    const recurring = [
      "scan",
      "backfill",
      "discovery_initial",
      "discovery_refresh",
      "competitor_scan",
      "seo_refresh",
    ];
    for (const kind of recurring) {
      const due = await nextRunAt(job(kind, projectId));
      expect(due, kind).toBeInstanceOf(Date);
      expect((due as Date).getTime(), kind).toBeGreaterThan(Date.now());
    }
    for (const kind of ["retention", "digest"]) {
      expect(await nextRunAt(job(kind, null)), kind).toBeInstanceOf(Date);
    }
    for (const kind of ["rescore", "insights", "noop"]) {
      expect(await nextRunAt(job(kind, projectId)), kind).toBeNull();
    }
  });
});
