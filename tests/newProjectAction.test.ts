import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What creating a project does inside the request. Reading Google for where a
 * product's buyers ask took about five minutes, which is longer than an ingress
 * will hold a request open, so the action reads the page, writes the profile
 * and hands everything else to one queued job.
 */

const runDiscovery = vi.fn();
const generateStructured = vi.fn();
const redirect = vi.fn();
let signedIn: { id: string } = { id: "" };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({ requireLocalUser: async () => signedIn }));
vi.mock("@/lib/llm", () => ({ generateStructured }));
vi.mock("@/lib/discovery/run", () => ({
  runDiscovery,
  discoveryBudget: () => ({ refreshDays: 7 }),
}));
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
              markdown: "Forms that branch.",
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

const profile = {
  name: "Formcraft",
  pain: "Forms cannot branch.",
  solution: "A form builder with conditional logic.",
  targetUsers: "Ops teams",
  capabilities: ["branching"],
  exclusions: [],
  notBuyers: ["students wanting a free plan"],
  serviceGeography: "Worldwide",
  destinations: [],
  problemPhrasings: ["forms that branch"],
  platforms: ["Zapier"],
  budgetFit: "Under $50 a month",
};

describe.skipIf(!process.env.DATABASE_URL)("creating a project", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    runDiscovery.mockClear();
    redirect.mockClear();
    generateStructured.mockReset();
    generateStructured.mockResolvedValue(profile);
  });

  it("answers the browser without reading Google, and queues the setup instead", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { and, eq, isNull } = await import("drizzle-orm");
    const { createProjectAndProfileAction } = await import(
      "@/app/app/projects/new/actions"
    );
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    signedIn = { id: user.id };

    const form = new FormData();
    form.set("name", "Formcraft");
    form.set("url", "https://formcraft.test");
    await createProjectAndProfileAction({ error: null }, form);

    expect(runDiscovery).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledTimes(1);

    const [project] = await db()
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.userId, user.id));
    expect(project.pain).toBe(profile.pain);
    // The platform the page names is stored as the searches a buyer types.
    expect(project.problemPhrasings).toEqual([
      "forms that branch",
      "zapier api",
      "zapier scraper",
    ]);
    expect(project.discoveredAt).toBeNull();

    const queued = await db()
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, project.id), isNull(schema.jobs.startedAt)));
    expect(queued.map((row) => row.kind)).toEqual(["discovery_initial"]);
  });
});
