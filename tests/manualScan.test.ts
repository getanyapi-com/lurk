import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Free gets one Scan now a day on top of its daily scan. A press holds for 24
 * hours from when it was made, a scheduled scan never uses it up, and a press
 * whose scan failed is given back.
 */
describe.skipIf(!process.env.DATABASE_URL)("the Scan now allowance", () => {
  it("counts only this project's presses from the last 24 hours that did not fail", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const { jobs, projects, users } = await import("@/db/schema");
    const { nextManualScanAt } = await import("@/jobs/enqueue");
    const { eq } = await import("drizzle-orm");

    const now = new Date();
    const ago = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);
    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    try {
      const [project, other] = await db()
        .insert(projects)
        .values([
          { userId: user.id, name: "Mine" },
          { userId: user.id, name: "Other" },
        ])
        .returning();

      // A scheduled scan, an old press, a failed press, and a press on another project.
      await db()
        .insert(jobs)
        .values([
          { kind: "scan", projectId: project.id, runAt: ago(1), startedAt: ago(1) },
          { kind: "scan", projectId: project.id, runAt: ago(25), startedAt: ago(25), manual: true },
          {
            kind: "scan",
            projectId: project.id,
            runAt: ago(2),
            startedAt: ago(2),
            error: "boom",
            manual: true,
          },
          { kind: "scan", projectId: other.id, runAt: ago(3), manual: true },
        ]);
      expect(await nextManualScanAt(project.id, 1, now)).toBeNull();
      expect(await nextManualScanAt(other.id, 1, now)).toEqual(new Date(ago(3).getTime() + 24 * HOUR_MS));

      await db()
        .insert(jobs)
        .values({ kind: "scan", projectId: project.id, runAt: ago(5), startedAt: ago(5), manual: true });
      expect(await nextManualScanAt(project.id, 1, now)).toEqual(new Date(ago(5).getTime() + 24 * HOUR_MS));
      expect(await nextManualScanAt(project.id, 2, now)).toBeNull();
      expect(await nextManualScanAt(project.id, null, now)).toBeNull();
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
    }
  });
});
