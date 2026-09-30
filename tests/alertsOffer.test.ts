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

  it("stops asking on the project it was dismissed on, and only that one", async () => {
    const { alertsOffer, dismissAlertsOffer } = await import("@/lib/alerts/offer");
    const { user, first, second } = await person();
    await dismissAlertsOffer(user.id, first.id);
    expect((await alertsOffer(user.id, first.id)).state).toBe("dismissed");
    expect((await alertsOffer(user.id, second.id)).state).toBe("ask");
  });
});
