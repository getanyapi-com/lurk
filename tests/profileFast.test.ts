import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A new project's two readings of its site. The fast one is written the moment
 * it is back, so discovery and the sweep start from it; the full one replaces
 * it when it lands, without a rescore, and never over a profile somebody has
 * changed in between.
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
              markdown: "Forms that branch. No free plan for students. Works with Google Sheets.",
            },
          },
        }),
      },
    },
    funding: "house" as const,
    call: async <T>(fn: () => Promise<T>) => ({ result: await fn(), requestId: null }),
  }),
  tierNameFor: async () => "free" as const,
}));

const brief = {
  kind: "conditional form builder",
  neighbours: [
    { kind: "survey tool", whyNot: "Polls opinions, no branching logic" },
    { kind: "paper forms", whyNot: "Manual, no logic" },
  ],
  buyers: ["ops teams"],
  nonBuyers: ["students"],
  price: "cheap self-serve",
  goodAsks: ["need a form that skips questions"],
  nearMisses: [{ ask: "best survey for my class", why: "A student, no budget" }],
};

const fastReading = {
  name: "Formcraft",
  pain: "Forms ask everyone every question.",
  solution: "Forms that skip what does not apply.",
  targetUsers: "Ops teams",
  budgetFit: "Teams paying monthly",
  capabilities: ["skip questions that do not apply"],
  problemPhrasings: ["my form asks everyone everything"],
  exclusions: [],
  notBuyers: [{ text: "students wanting a free plan", sourceText: "No free plan for students" }],
  brief,
};

const fullReading = {
  name: "Formcraft",
  pain: "Long forms ask people questions that do not apply to them.",
  solution: "A form builder with conditional logic.",
  targetUsers: "Operations teams collecting requests",
  capabilities: ["Build a form that skips questions", "Send answers to a spreadsheet"],
  exclusions: [],
  notBuyers: [{ text: "students wanting a free plan", sourceText: "No free plan for students" }],
  serviceGeography: "Worldwide",
  destinations: [],
  problemPhrasings: ["forms that branch"],
  platforms: ["Google Sheets"],
  sellsPlatformData: false,
  competitors: [{ name: "Typeform", domain: "typeform.com" }],
  budgetFit: "Under $50 a month",
  brief: { ...brief, kind: "form builder with branching" },
};

/** A call held until the test lets it answer. */
function held<T>(value: T | Error) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    answer: async () => {
      await gate;
      if (value instanceof Error) {
        throw value;
      }
      return value;
    },
  };
}

async function fixture() {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const [user] = await db()
    .insert(schema.users)
    .values({ clerkUserId: `test_${randomUUID()}` })
    .returning();
  const [project] = await db()
    .insert(schema.projects)
    .values({ userId: user.id, name: "formcraft.test", url: "https://formcraft.test" })
    .returning();
  const { eq } = await import("drizzle-orm");
  const row = async () =>
    (await db().select().from(schema.projects).where(eq(schema.projects.id, project.id)))[0];
  const competitors = async () =>
    (
      await db()
        .select()
        .from(schema.projectCompetitors)
        .where(eq(schema.projectCompetitors.projectId, project.id))
    ).map((item) => item.name);
  return { db, schema, eq, user, project, row, competitors };
}

describe.skipIf(!process.env.DATABASE_URL)("a new project's fast reading", () => {
  beforeEach(() => {
    generateStructured.mockReset();
  });

  function answer(fast: ReturnType<typeof held>, full: ReturnType<typeof held>) {
    generateStructured.mockImplementation(async (call: { purpose: string }) =>
      call.purpose === "profile_fast" ? fast.answer() : full.answer(),
    );
  }

  it("writes the fast reading first, then the full one over it without a rescore", async () => {
    const { user, project, row, competitors } = await fixture();
    const { buildProfileFast } = await import("@/lib/profile");
    const fast = held(fastReading);
    const full = held(fullReading);
    answer(fast, full);

    const building = buildProfileFast(project.id, user.id, project.url!);
    await vi.waitFor(() => expect(generateStructured).toHaveBeenCalledTimes(3));
    const fastCall = generateStructured.mock.calls.find(([call]) => call.purpose === "profile_fast")![0];
    expect(fastCall.effort).toBe("minimal");
    fast.release();
    const built = await building;

    const first = await row();
    expect(first.pain).toBe(fastReading.pain);
    expect(first.problemPhrasings).toEqual(fastReading.problemPhrasings);
    expect(first.notBuyers).toEqual(["students wanting a free plan"]);
    // Stored with the two keys an older revision still requires (brief.ts storedBrief).
    expect(first.brief).toEqual({ ...brief, freePlan: null, limits: [] });
    expect(first.geography).toBeNull();
    expect(await competitors()).toEqual([]);

    full.release();
    expect(await built.full).toBe(true);
    const after = await row();
    expect(after.pain).toBe(fullReading.pain);
    expect(after.geography).toBe("Worldwide");
    expect(after.capabilities).toEqual(fullReading.capabilities);
    expect(after.brief).toMatchObject({ kind: "form builder with branching" });
    expect(await competitors()).toEqual(["Typeform"]);
    // Same version, brief still current: nothing is queued to be judged again.
    expect(after.profileVersion).toBe(first.profileVersion);
    expect(after.briefProfileVersion).toBe(after.profileVersion);
  });

  it("leaves a profile somebody edited before the full reading landed", async () => {
    const { db, schema, eq, user, project, row, competitors } = await fixture();
    const { buildProfileFast } = await import("@/lib/profile");
    const fast = held(fastReading);
    const full = held(fullReading);
    answer(fast, full);
    fast.release();
    const built = await buildProfileFast(project.id, user.id, project.url!);

    await db()
      .update(schema.projects)
      .set({ pain: "My own words for the pain." })
      .where(eq(schema.projects.id, project.id));
    full.release();

    expect(await built.full).toBe(false);
    const after = await row();
    expect(after.pain).toBe("My own words for the pain.");
    expect(after.solution).toBe(fastReading.solution);
    expect(await competitors()).toEqual([]);
  });

  it("waits for the full reading when the fast one fails", async () => {
    const { user, project, row, competitors } = await fixture();
    const { buildProfileFast } = await import("@/lib/profile");
    const fast = held(new Error("No object generated: could not parse the response."));
    const full = held(fullReading);
    answer(fast, full);
    fast.release();
    const building = buildProfileFast(project.id, user.id, project.url!);
    await vi.waitFor(() => expect(generateStructured).toHaveBeenCalledTimes(3));
    full.release();
    const built = await building;

    expect(built.reading.pain).toBe(fullReading.pain);
    expect(await built.full).toBe(false);
    expect((await row()).geography).toBe("Worldwide");
    expect(await competitors()).toEqual(["Typeform"]);
  });

  it("names competitors from their own reading, and keeps the page's when that fails", async () => {
    const { user, project, competitors } = await fixture();
    const { buildProfileFast } = await import("@/lib/profile");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rivals: () => Promise<unknown> = async () => ({
      job: "build forms that branch",
      category: "form builder",
      competitors: [
        { name: "Jotform", domain: "jotform.com", reason: "conditional forms" },
        { name: "Tally", domain: "tally.so", reason: "free branching forms" },
      ],
    });
    generateStructured.mockImplementation(async (call: { purpose: string }) =>
      call.purpose === "profile_fast" ? fastReading : call.purpose === "competitors" ? rivals() : fullReading,
    );
    const built = await buildProfileFast(project.id, user.id, project.url!);
    expect(await built.full).toBe(true);
    expect((await competitors()).sort()).toEqual(["Jotform", "Tally"]);

    rivals = async () => {
      throw new Error("No object generated");
    };
    const again = await fixture();
    const second = await buildProfileFast(again.project.id, again.user.id, again.project.url!);
    expect(await second.full).toBe(true);
    expect(await again.competitors()).toEqual(["Typeform"]);
    warn.mockRestore();
  });

  it("keeps the fast reading when the full one fails", async () => {
    const { user, project, row } = await fixture();
    const { buildProfileFast } = await import("@/lib/profile");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fast = held(fastReading);
    const full = held(new Error("The language model did not answer"));
    answer(fast, full);
    fast.release();
    const built = await buildProfileFast(project.id, user.id, project.url!);
    full.release();

    expect(await built.full).toBe(false);
    expect((await row()).pain).toBe(fastReading.pain);
    warn.mockRestore();
  });
});

/**
 * A rebuild of an existing project's profile reads the site once, with no fast
 * reading, and invalidates the verdicts made against the old facts.
 */
describe.skipIf(!process.env.DATABASE_URL)("rebuilding a profile", () => {
  beforeEach(() => {
    generateStructured.mockReset();
  });

  it("reads the tier during a new profile's model call and still caps its competitors", async () => {
    const { user, project, row, competitors } = await fixture();
    const tier = await import("@/lib/tier");
    const { buildProfile } = await import("@/lib/profile");
    const current = await tier.limitsForUser(user.id);
    const lookup = vi.spyOn(tier, "limitsForUser").mockResolvedValue({
      ...current, limits: { ...(await import("@/lib/tiers")).TIERS.free, competitors: 1 },
    });
    const reading = held({ ...fullReading, competitors: [
      { name: "Typeform", domain: "typeform.com" },
      { name: "Other", domain: "other.test" },
    ] });
    generateStructured.mockImplementation(reading.answer);
    const build = buildProfile(project.id, user.id, project.url!);
    try {
      await vi.waitFor(() => {
        // The reading and the competitors' own reading, side by side.
        expect(generateStructured).toHaveBeenCalledTimes(2);
        expect(lookup).toHaveBeenCalledWith(user.id);
      });
      reading.release();
      const result = await build;
      expect(result.problemPhrasings).toEqual(fullReading.problemPhrasings);
      expect(await competitors()).toEqual(["Typeform"]);
      const written = await row();
      expect(written.profileVersion).toBe(2);
      expect(written.briefProfileVersion).toBe(2);
      expect(written.pain).toBe(fullReading.pain);
    } finally {
      reading.release();
      await build;
      lookup.mockRestore();
    }
  });
});
