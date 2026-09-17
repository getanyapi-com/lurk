import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { cadenceFor } from "@/lib/settings/cadence";
import { PRESETS } from "@/lib/settings/presets";
import { resolveSettings } from "@/lib/settings/resolve";
import { settingsOverridesSchema } from "@/lib/settings/schema";
import { threadPolicyFor } from "@/lib/settings/threadPolicy";

/**
 * The settings module owns every number a scan's cadence and thread policy
 * use, so what is proved here is the arithmetic and the merge: an hour a user
 * picked is that hour on the day the clocks move, and a preset never gives up
 * a value the user is not allowed to change.
 */

const NEW_YORK = "America/New_York";

describe("a daily cadence", () => {
  it("keeps the chosen hour on the day the clocks go forward", () => {
    const cadence = cadenceFor({ kind: "daily", hour: 9, timezone: NEW_YORK });
    // 10:00 in New York on the day before the spring change.
    const next = cadence.nextRunAt(new Date("2026-03-07T15:00:00Z"));

    expect(next.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("keeps the chosen hour on the day the clocks go back", () => {
    const cadence = cadenceFor({ kind: "daily", hour: 9, timezone: NEW_YORK });
    // 10:00 in New York on the day before the autumn change.
    const next = cadence.nextRunAt(new Date("2026-10-31T14:00:00Z"));

    expect(next.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("runs later the same day when the hour has not passed yet", () => {
    const cadence = cadenceFor({ kind: "daily", hour: 9, timezone: NEW_YORK });

    expect(cadence.nextRunAt(new Date("2026-06-10T04:00:00Z")).toISOString()).toBe(
      "2026-06-10T13:00:00.000Z",
    );
  });

  it("waits for tomorrow when the hour has just gone, and counts a whole day", () => {
    const cadence = cadenceFor({ kind: "daily", hour: 9, timezone: "UTC" });

    expect(cadence.nextRunAt(new Date("2026-06-10T09:00:00Z")).toISOString()).toBe(
      "2026-06-11T09:00:00.000Z",
    );
    expect(cadence.intervalHours()).toBe(24);
  });
});

describe("an interval cadence", () => {
  it("counts its hours from the run that just finished", () => {
    const cadence = cadenceFor({ kind: "interval", hours: 1 });

    expect(cadence.intervalHours()).toBe(1);
    expect(cadence.nextRunAt(new Date("2026-06-10T09:30:00Z")).toISOString()).toBe(
      "2026-06-10T10:30:00.000Z",
    );
  });
});

describe("what a user may change", () => {
  it("drops a setting the free preset does not offer, and keeps the hour", () => {
    const resolved = resolveSettings("free", {
      cadence: { hour: 7, hours: 2 },
      threads: { threadsPerScan: null, readSeoReplies: true },
    });

    expect(resolved.settings.cadence).toEqual({ kind: "daily", hour: 7, timezone: "UTC" });
    expect(resolved.settings.threads).toEqual(PRESETS.free.threads);
  });

  it("gives a connected wallet every key, including a daily hour of its own", () => {
    const hourly = resolveSettings("connected", { threads: { threadsPerScan: 5 } });
    const daily = resolveSettings("connected", { cadence: { hour: 7, timezone: NEW_YORK } });

    expect(hourly.settings.cadence).toEqual(PRESETS.connected.cadence);
    expect(hourly.settings.threads.threadsPerScan).toBe(5);
    expect(daily.settings.cadence).toEqual({ kind: "daily", hour: 7, timezone: NEW_YORK });
  });

  it("is the preset itself when the user has saved nothing", () => {
    expect(resolveSettings("selfHost", null).settings).toEqual(PRESETS.selfHost);
    expect([...resolveSettings("free", null).editable]).toEqual([
      "cadence.hour",
      "cadence.timezone",
    ]);
  });
});

describe("the saved override object", () => {
  it("refuses an hour that is not on a clock and a zone that is not a place", () => {
    expect(settingsOverridesSchema.safeParse({ cadence: { hour: 24 } }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ cadence: { hour: 23 } }).success).toBe(true);
    expect(settingsOverridesSchema.safeParse({ cadence: { timezone: "Mars/Olympus" } }).success).toBe(
      false,
    );
    expect(settingsOverridesSchema.safeParse({ cadence: { timezone: NEW_YORK } }).success).toBe(true);
  });

  it("refuses a thread count of zero but allows no cap at all", () => {
    expect(settingsOverridesSchema.safeParse({ threads: { threadsPerScan: 0 } }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ threads: { threadsPerScan: null } }).success).toBe(
      true,
    );
  });
});

describe("a thread policy", () => {
  it("measures the reply window back from the instant it was built", () => {
    const now = new Date("2026-06-10T09:00:00Z");
    const policy = threadPolicyFor(PRESETS.free.threads, now);

    expect(policy.freshSince(now).toISOString()).toBe("2026-06-07T09:00:00.000Z");
    expect(policy.threadsPerScan).toBe(20);
    expect(policy.readSeoReplies).toBe(false);
  });
});

/**
 * Saving settings has to move the schedule, or a free user who picks 9am waits
 * until the scan already booked under the old cadence happens to run.
 */
describe.skipIf(!process.env.DATABASE_URL)("saving settings against a database", () => {
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let saveUserSettings: typeof import("@/lib/settings/resolve").saveUserSettings;
  let nextScanJob: typeof import("@/jobs/enqueue").nextScanJob;
  let eq: typeof import("drizzle-orm").eq;

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    ({ saveUserSettings } = await import("@/lib/settings/resolve"));
    ({ nextScanJob } = await import("@/jobs/enqueue"));
    ({ eq } = await import("drizzle-orm"));
  });

  it("moves a waiting scan to the new cadence and leaves a project without one alone", async () => {
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [scheduled] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Scheduled" })
      .returning();
    const [idle] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Idle" })
      .returning();
    const far = new Date("2030-01-01T00:00:00Z");
    await db().insert(schema.jobs).values({ kind: "scan", projectId: scheduled.id, runAt: far });

    const resolved = await saveUserSettings(user.id, {
      cadence: { hour: 9, timezone: "UTC" },
    });

    expect(resolved.settings.cadence).toEqual({ kind: "daily", hour: 9, timezone: "UTC" });
    const moved = await nextScanJob(scheduled.id);
    const expected = cadenceFor(resolved.settings.cadence).nextRunAt(new Date());
    expect(moved?.runAt.getTime()).toBeLessThan(far.getTime());
    expect(Math.abs((moved?.runAt.getTime() ?? 0) - expected.getTime())).toBeLessThan(60_000);
    expect(await nextScanJob(idle.id)).toBeNull();

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});
