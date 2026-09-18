import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";

let signedIn: { id: string } = { id: "" };
const kickScheduler = vi.fn();
vi.mock("@/lib/auth", () => ({ requireLocalUser: async () => signedIn }));
vi.mock("@/jobs/scheduler", () => ({ kickScheduler }));

/**
 * The Reddit SEO pass and the competitor scan are bought when their tab is
 * first opened. What has to hold: the first open queues one job, a second open
 * queues nothing, and nobody starts a job on a project that is not theirs.
 */
describe("startOnOpen against a database", () => {
  async function owned() {
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `user_${randomUUID()}`, email: `${randomUUID()}@example.com` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft" })
      .returning();
    return { user, project };
  }

  const queued = (projectId: string, kind: string) =>
    db()
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.kind, kind)));

  it("queues the tab's job on the first open and nothing on the second", async () => {
    const { startOnOpen } = await import("@/lib/startOnOpen");
    const { user, project } = await owned();
    signedIn = { id: user.id };

    expect(await startOnOpen("seo_refresh", project.id)).toBe(true);
    expect(await startOnOpen("seo_refresh", project.id)).toBe(false);

    expect(await queued(project.id, "seo_refresh")).toHaveLength(1);
    expect(await queued(project.id, "competitor_scan")).toHaveLength(0);
    expect(kickScheduler).toHaveBeenCalledTimes(1);
  });

  it("refuses a project that belongs to somebody else", async () => {
    const { startOnOpen } = await import("@/lib/startOnOpen");
    const { project } = await owned();
    const stranger = await owned();
    signedIn = { id: stranger.user.id };

    await expect(startOnOpen("competitor_scan", project.id)).rejects.toThrow("not yours");
    expect(await queued(project.id, "competitor_scan")).toHaveLength(0);
  });
});
