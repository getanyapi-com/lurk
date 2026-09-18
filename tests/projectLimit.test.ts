import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIERS } from "@/lib/tiers";

describe.skipIf(!process.env.DATABASE_URL)("the project limit under concurrent requests", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets through only as many projects as the tier allows", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    vi.stubEnv("SELF_HOSTED", "false");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { createProject, listProjects } = await import("@/lib/projects");
    const { eq } = await import("drizzle-orm");
    const limit = TIERS.free.projects as number;

    const [user] = await db()
      .insert(users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    try {
      const attempts = await Promise.allSettled(
        Array.from({ length: limit + 4 }, (_, index) => createProject(user.id, `P${index}`, null)),
      );
      expect(attempts.filter((one) => one.status === "fulfilled")).toHaveLength(limit);
      expect(await listProjects(user.id)).toHaveLength(limit);
    } finally {
      await db().delete(users).where(eq(users.id, user.id));
    }
  });
});
