import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { safeReturnPath } from "@/lib/alerts/offer";

vi.mock("@/jobs/enqueue", () => ({ enqueueOnce: vi.fn() }));

describe("safeReturnPath", () => {
  it("keeps a path inside the app and refuses anything that could leave it", () => {
    expect(safeReturnPath("/app/leads?project=abc")).toBe("/app/leads?project=abc");
    expect(safeReturnPath("https://evil.example/app/")).toBeNull();
    expect(safeReturnPath("//evil.example/app/")).toBeNull();
    expect(safeReturnPath("/app/\\evil.example")).toBeNull();
    expect(safeReturnPath("/settings")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});

/** The offer asks, then says where leads go, and "Not now" holds per project. */
describe.skipIf(!process.env.DATABASE_URL)("alerts offer", () => {
  async function person() {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const email = `offer-${randomUUID()}@example.com`;
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}`, email })
      .returning();
    const [first, second] = await db()
      .insert(schema.projects)
      .values([
        { userId: user.id, name: "First" },
        { userId: user.id, name: "Second" },
      ])
      .returning();
    return { user, first, second, email };
  }

  it("asks, then names the email once it is on, adding it only once", async () => {
    const { alertsOffer, turnOnEmailAlerts } = await import("@/lib/alerts/offer");
    const { listChannels } = await import("@/lib/alerts/channels");
    const { user, first, email } = await person();
    expect(await alertsOffer(user.id, first.id)).toEqual({ state: "ask", email });
    await turnOnEmailAlerts(user.id, first.id);
    await turnOnEmailAlerts(user.id, first.id);
    const channels = await listChannels(first.id);
    expect(channels.map((one) => [one.channel, one.target, one.cadence])).toEqual([["email", email, "daily"]]);
    expect(await alertsOffer(user.id, first.id)).toEqual({
      state: "on",
      channels: [{ channel: "email", where: email }],
    });
  });

  it("knows the address it already sends to when the account's copy has a stray space", async () => {
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { turnOnEmailAlerts } = await import("@/lib/alerts/offer");
    const { listChannels } = await import("@/lib/alerts/channels");
    const { user, first, email } = await person();
    await db().update(schema.users).set({ email: `${email} ` }).where(eq(schema.users.id, user.id));

    await turnOnEmailAlerts(user.id, first.id);
    await turnOnEmailAlerts(user.id, first.id);

    expect((await listChannels(first.id)).map((one) => one.target)).toEqual([email]);
  });

  it("refuses a custom webhook past the owner's tier, and the same channel twice", async () => {
    const { addChannel } = await import("@/lib/alerts/channels");
    const { TIERS } = await import("@/lib/tiers");
    const { user, first } = await person();
    const selfHosted = process.env.SELF_HOSTED;
    process.env.SELF_HOSTED = "false";
    try {
      const hook = (n: number) => ({
        projectId: first.id,
        userId: user.id,
        channel: "webhook" as const,
        target: `https://example.com/hook/${n}`,
        cadence: "daily" as const,
      });
      for (let n = 0; n < (TIERS.free.customWebhooks ?? 0); n += 1) {
        await addChannel(hook(n));
      }
      await expect(addChannel(hook(99))).rejects.toThrow("custom webhook");
      const slack = {
        projectId: first.id,
        userId: user.id,
        channel: "slack" as const,
        target: "https://hooks.slack.com/services/T/B/x",
        cadence: "daily" as const,
      };
      await addChannel(slack);
      await expect(addChannel(slack)).rejects.toThrow("already on this project");
      expect((await addChannel({ ...slack, ifMissing: true })).target).toBe(slack.target);
    } finally {
      if (selfHosted === undefined) {
        delete process.env.SELF_HOSTED;
      } else {
        process.env.SELF_HOSTED = selfHosted;
      }
    }
  });

  it("stops asking on the project it was dismissed on, and only that one", async () => {
    const { alertsOffer, dismissAlertsOffer } = await import("@/lib/alerts/offer");
    const { user, first, second } = await person();
    await dismissAlertsOffer(user.id, first.id);
    expect((await alertsOffer(user.id, first.id)).state).toBe("dismissed");
    expect((await alertsOffer(user.id, second.id)).state).toBe("ask");
  });
});
