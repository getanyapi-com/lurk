import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one new reading an older project gets. A profile nobody touched is
 * replaced by it; one a person edited keeps every word, and only gains the
 * limits it never had. Either change makes the stored verdicts stale.
 */

const generateStructured = vi.fn();

vi.mock("@/lib/llm", () => ({ generateStructured }));
vi.mock("@/lib/anyapi", () => ({
  clientForUser: async () => ({
    client: {
      web: {
        scrape: async () => ({
          costUsd: 0,
          output: {
            found: true,
            data: {
              url: "https://formcraft.test",
              title: "Formcraft",
              description: "Forms",
              markdown: "Forms that branch. No free plan for students.",
            },
          },
        }),
      },
    },
    funding: "house" as const,
    call: async <T>(fn: () => Promise<T>) => ({ result: await fn(), requestId: null }),
  }),
  walletConnection: async () => null,
}));

const reading = {
  name: "Formcraft",
  pain: "Forms cannot branch.",
  solution: "A form builder with conditional logic.",
  targetUsers: "Ops teams",
  capabilities: ["Build a form that skips questions"],
  exclusions: [],
  notBuyers: [{ text: "students wanting a free plan", sourceText: "No free plan for students" }],
  serviceGeography: "Worldwide",
  destinations: [],
  problemPhrasings: ["forms that branch"],
  platforms: [],
  sellsPlatformData: false,
  competitors: [],
  budgetFit: "Under $50 a month",
};

async function fixture(profileVersion: number) {
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
      url: "https://formcraft.test",
      pain: "An old reading of the pain.",
      solution: "An old reading.",
      targetUsers: "Anyone",
      capabilities: ["forms"],
      discoveredAt: new Date(),
      profileVersion,
    })
    .returning();
  return { db, schema, user, project };
}

describe.skipIf(!process.env.DATABASE_URL)("reading an older project's site again", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    generateStructured.mockReset();
    generateStructured.mockResolvedValue(reading);
  });

  async function reseed(projectId: string) {
    const { JOB_HANDLERS } = await import("@/jobs/registry");
    const job = { id: randomUUID(), projectId } as unknown as Parameters<
      (typeof JOB_HANDLERS)["profile_reseed"]
    >[0];
    await JOB_HANDLERS.profile_reseed(job);
  }

  it("replaces a profile nobody touched, and has its verdicts judged again", async () => {
    const { db, schema, user, project } = await fixture(1);
    const { eq } = await import("drizzle-orm");

    await reseed(project.id);

    const [after] = await db().select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(after.pain).toBe("Forms cannot branch.");
    expect(after.capabilities).toEqual(["Build a form that skips questions"]);
    expect(after.notBuyers).toEqual(["students wanting a free plan"]);
    expect(after.profileVersion).toBe(2);
    const queued = await db().select().from(schema.jobs).where(eq(schema.jobs.projectId, project.id));
    expect(queued.map((row) => row.kind)).toEqual(["rescore"]);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("keeps what a person wrote, and only fills the limits they never had", async () => {
    const { db, schema, user, project } = await fixture(3);
    const { eq } = await import("drizzle-orm");

    await reseed(project.id);

    const [after] = await db().select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(after.pain).toBe("An old reading of the pain.");
    expect(after.capabilities).toEqual(["forms"]);
    expect(after.notBuyers).toEqual(["students wanting a free plan"]);
    expect(after.profileVersion).toBe(4);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});
