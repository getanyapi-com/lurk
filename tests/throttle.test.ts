import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { opensAtFrom } from "@/lib/throttle";
import { TIERS } from "@/lib/tiers";

const HOUR_MS = 60 * 60 * 1000;
const at = (hours: number) => new Date(Date.UTC(2026, 8, 18) + hours * HOUR_MS);

describe("when a paid button comes back", () => {
  it("is open while presses are left", () => {
    expect(opensAtFrom([at(0), at(1)], 3)).toBeNull();
  });

  it("opens 24 hours after the press that frees a slot", () => {
    expect(opensAtFrom([at(0), at(1), at(2)], 3)).toEqual(at(24));
    expect(opensAtFrom([at(0), at(1), at(2)], 2)).toEqual(at(25));
  });

  it("gives free no Scan now at all", () => {
    expect(TIERS.free.actionsPerDay.scan_now).toBe(0);
    expect(TIERS.connected.actionsPerDay.scan_now).toBeGreaterThan(0);
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

  it("is refused past the day's allowance, and a double click costs one press", async () => {
    vi.stubEnv("SELF_HOSTED", "false");
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { jobs, projects, users } = await import("@/db/schema");
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
      expect(await allowanceFor(user.id, "scan_now")).toEqual({ limit: 0, opensAt: null });

      // A second press while the first is still due queues nothing and counts nothing.
      await pressForJob(user.id, "seo_refresh", "seo_refresh", project.id);
      await pressForJob(user.id, "seo_refresh", "seo_refresh", project.id);
      const queued = await db().select().from(jobs).where(eq(jobs.projectId, project.id));
      expect(queued).toHaveLength(1);

      // Free has one press, so once that job has started the next one is refused.
      await db().update(jobs).set({ startedAt: new Date() }).where(eq(jobs.projectId, project.id));
      const spent = await allowanceFor(user.id, "seo_refresh");
      expect(spent.opensAt?.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR_MS);
      await expect(
        pressForJob(user.id, "seo_refresh", "seo_refresh", project.id),
      ).rejects.toBeInstanceOf(ActionThrottledError);

      // Each button has its own allowance.
      expect((await allowanceFor(user.id, "insights")).opensAt).toBeNull();
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
    }
  });
});
