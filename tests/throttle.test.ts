import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { opensAtFrom } from "@/lib/throttle";
import { TIERS } from "@/lib/tiers";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const at = (hours: number) => new Date(Date.UTC(2026, 8, 18) + hours * HOUR_MS);

describe("when a paid button comes back", () => {
  it("is open while presses are left", () => {
    expect(opensAtFrom([at(0)], 2)).toBeNull();
  });

  it("opens 24 hours after the press that frees a slot", () => {
    expect(opensAtFrom([at(0), at(1), at(2)], 3)).toEqual(at(24));
    expect(opensAtFrom([at(0), at(1), at(2)], 2)).toEqual(at(25));
  });

  it("gives free each paid button once for good, and no Scan now", () => {
    expect(TIERS.free.actions.window).toBe("ever");
    expect(TIERS.free.actions.presses).toEqual({
      scan_now: 0,
      rebuild_profile: 1,
      seo_refresh: 1,
      competitor_scan: 1,
      insights: 1,
    });
    expect(TIERS.connected.actions.window).toBe("day");
  });
});

/**
 * One account looping a paid button runs out of its own presses, so the house
 * caps every user shares are never its to trip.
 */
describe.skipIf(!process.env.DATABASE_URL)("a free user pressing paid buttons", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gets each once for good, and a double click costs one press", async () => {
    vi.stubEnv("SELF_HOSTED", "false");
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { jobs, projects, userActions, users } = await import("@/db/schema");
    const { ActionThrottledError, allowanceFor, pressForJob, spendAllowance } = await import(
      "@/lib/throttle"
    );
    const { eq } = await import("drizzle-orm");

    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    try {
      const [project] = await db()
        .insert(projects)
        .values({ userId: user.id, name: "Throttled" })
        .returning();

      await expect(spendAllowance(user.id, "scan_now")).rejects.toBeInstanceOf(
        ActionThrottledError,
      );
      expect((await allowanceFor(user.id, "scan_now")).spent).toBe(true);

      // A second press while the first is still due queues nothing and counts nothing.
      expect((await allowanceFor(user.id, "seo_refresh")).spent).toBe(false);
      await pressForJob(user.id, "seo_refresh", "seo_refresh", project.id);
      await pressForJob(user.id, "seo_refresh", "seo_refresh", project.id);
      expect(await db().select().from(jobs).where(eq(jobs.projectId, project.id))).toHaveLength(1);

      // The one press is spent for good, even a week later.
      await db()
        .update(userActions)
        .set({ at: new Date(Date.now() - 7 * DAY_MS) })
        .where(eq(userActions.userId, user.id));
      await db().update(jobs).set({ startedAt: new Date() }).where(eq(jobs.projectId, project.id));
      expect(await allowanceFor(user.id, "seo_refresh")).toMatchObject({
        spent: true,
        opensAt: null,
      });
      await expect(
        pressForJob(user.id, "seo_refresh", "seo_refresh", project.id),
      ).rejects.toBeInstanceOf(ActionThrottledError);

      // Each button has its own press.
      expect((await allowanceFor(user.id, "insights")).spent).toBe(false);
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
    }
  });
});
