import { afterEach, describe, expect, it } from "vitest";
import { xEnabledFor } from "@/lib/x/enabled";

/**
 * The X switch. X_LEADS is the kill switch, for everyone including the
 * allowlist; X_LEADS_USERS only narrows it. And while X is off for a caller,
 * the public API shows none of X's limits: a feature that ships dark stays dark.
 */
describe("the X leads switch", () => {
  const saved = { on: process.env.X_LEADS, users: process.env.X_LEADS_USERS };
  afterEach(() => {
    process.env.X_LEADS = saved.on;
    process.env.X_LEADS_USERS = saved.users;
  });

  it.each([
    ["false", "", "u1", false],
    ["false", "u1", "u1", false],
    ["true", "", "u1", true],
    ["true", "u1,u2", "u1", true],
    ["true", "u1,u2", "u3", false],
    ["true", " u1 , u2 ", "u2", true],
    ["true", "", null, false],
  ] as const)("X_LEADS=%s X_LEADS_USERS=%j for %s is %s", (on, users, user, expected) => {
    process.env.X_LEADS = on;
    process.env.X_LEADS_USERS = users;
    expect(xEnabledFor(user)).toBe(expected);
  });

  it.skipIf(!process.env.DATABASE_URL)("keeps X's limits out of /api/v1/me unless X is on for the caller", async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { me } = await import("@/lib/api/handlers");
    const { TIERS } = await import("@/lib/tiers");
    const caller = {
      user: { id: "u1", email: null, createdAt: new Date(0) },
      tier: "free",
      selfHosted: false,
      limits: TIERS.free,
      keyPrefix: "lk_x",
      scopes: [],
      keyId: "00000000-0000-0000-0000-000000000000",
    } as unknown as Parameters<typeof me>[0];
    type Shown = Record<string, unknown> & { actions: { presses: Record<string, number> } };

    process.env.X_LEADS = "false";
    const off = (await me(caller)).limits as Shown;
    expect(off).not.toHaveProperty("x");
    expect(off.actions.presses).not.toHaveProperty("x_scan_now");
    expect(off.actions.presses.scan_now).toBe(0);
    expect(off.projects).toBe(2);
    expect(TIERS.free.x).toBeDefined();

    process.env.X_LEADS = "true";
    process.env.X_LEADS_USERS = "u1";
    const on = (await me(caller)).limits as Shown;
    expect(on).toHaveProperty("x");
  });
});
