import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Invite and alert links already sit in inboxes, and do not expire. These
 * tokens were minted by the signers invite.ts and act.ts each held before they
 * shared one, under a fixed key, so a change to either purpose or payload
 * encoding fails here before it breaks a link somebody has yet to click.
 */
const KEY = Buffer.alloc(32, 7).toString("base64");
const OLD_INVITE = "user-123.anWQp6pJL8YrbOJlgVVxw5ypI0oYtrHW5yaFA5mzh0M";
const OLD_REPLIED = "cmVwbGllZApwMQpyZWRkaXQKdDNfYWJj.xyIKg3rzdF0XzyBoFl4olMfr66bBEb93w0O4EpmwLps";
const OLD_MUTE = "bXV0ZQpwMQpTYWFT.3Mfvrs004OTAovMKPs5jo41-1pzX9tn5ZqPYLMkybaU";

describe("signed links", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("still opens an invite link sent before the signer was shared, and mints the same one", async () => {
    const { inviteToken, userForToken } = await import("@/lib/alerts/invite");
    expect(userForToken(OLD_INVITE)).toBe("user-123");
    expect(inviteToken("user-123")).toBe(OLD_INVITE);
  });

  it("still opens Mark replied and Mute links sent before, and mints the same ones", async () => {
    const { actForToken, actToken } = await import("@/lib/alerts/act");
    const replied = { act: "replied", projectId: "p1", platform: "reddit", threadId: "t3_abc" } as const;
    const mute = { act: "mute", projectId: "p1", subreddit: "SaaS" } as const;
    expect(actForToken(OLD_REPLIED)).toEqual(replied);
    expect(actForToken(OLD_MUTE)).toEqual(mute);
    expect(actToken(replied)).toBe(OLD_REPLIED);
    expect(actToken(mute)).toBe(OLD_MUTE);
  });

  it("never takes a token signed for one kind of link as another", async () => {
    const { signToken, verifyToken } = await import("@/lib/alerts/signedLink");
    const { userForToken } = await import("@/lib/alerts/invite");
    const { actForToken } = await import("@/lib/alerts/act");
    expect(userForToken(OLD_REPLIED)).toBeNull();
    expect(actForToken(signToken("alert-invite", "cmVwbGllZApwMQpyZWRkaXQKdDNfYWJj"))).toBeNull();
    expect(verifyToken("alert-act", OLD_INVITE)).toBeNull();
  });

  it("refuses a token signed under another key", async () => {
    const { userForToken } = await import("@/lib/alerts/invite");
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    expect(userForToken(OLD_INVITE)).toBeNull();
  });
});
