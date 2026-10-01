import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Both legs of Add to Slack and Add to Discord, through the routes the
 * services' apps are registered with. The paths and the cookie names are what
 * an install already under way, or a service's app settings, depend on.
 */

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireLocalUser: async () => ({ id: auth.userId }),
}));
vi.mock("@/jobs/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/jobs/enqueue")>()),
  enqueueOnce: vi.fn(),
}));

async function person() {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const [user] = await db()
    .insert(schema.users)
    .values({ clerkUserId: `test_${randomUUID()}` })
    .returning();
  const [project] = await db().insert(schema.projects).values({ userId: user.id, name: "Chat" }).returning();
  auth.userId = user.id;
  return { user, project, db, schema };
}

/** The value a response set for one cookie, as the browser would send it back. */
function setCookie(response: Response, name: string): string | null {
  const header = response.headers.getSetCookie().find((one) => one.startsWith(`${name}=`));
  return header ? header.slice(name.length + 1).split(";")[0] : null;
}

describe.skipIf(!process.env.DATABASE_URL)("adding a chat channel in one click", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://lurk.so/");
    vi.stubEnv("SLACK_CLIENT_ID", "1.2");
    vi.stubEnv("SLACK_CLIENT_SECRET", "shh");
    vi.stubEnv("DISCORD_CLIENT_ID", "123");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "shh");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("goes to Slack and back, adding the named channel and landing where it was asked from", async () => {
    const { user, project, db, schema } = await person();
    const start = await import("@/app/connect/slack/route");
    const callback = await import("@/app/connect/slack/callback/route");
    const { listChannels } = await import("@/lib/alerts/channels");

    const out = await start.GET(
      new NextRequest(
        `https://lurk.so/connect/slack?project=${project.id}&cadence=hourly&back=${encodeURIComponent("/app/leads?project=x")}`,
      ),
    );
    const sentTo = new URL(out.headers.get("location") ?? "");
    expect(sentTo.origin + sentTo.pathname).toBe("https://slack.com/oauth/v2/authorize");
    const cookie = setCookie(out, "slack_oauth");
    expect(cookie).not.toBeNull();
    expect(out.headers.getSetCookie()[0]).toContain("Path=/connect");
    const stash = JSON.parse(decodeURIComponent(cookie ?? ""));
    expect(stash).toEqual({
      state: sentTo.searchParams.get("state"),
      projectId: project.id,
      cadence: "hourly",
      back: "/app/leads?project=x",
    });

    vi.stubGlobal("fetch", async () =>
      Response.json({
        ok: true,
        team: { name: "AnyAPI" },
        incoming_webhook: { url: "https://hooks.slack.com/services/T/B/x", channel: "#leads" },
      }),
    );
    const back = await callback.GET(
      new NextRequest(`https://lurk.so/connect/slack/callback?code=c&state=${stash.state}`, {
        headers: { cookie: `slack_oauth=${cookie}` },
      }),
    );
    expect(back.headers.get("location")).toBe("https://lurk.so/app/leads?project=x");
    expect(setCookie(back, "slack_oauth")).toBe("");
    const channels = await listChannels(project.id);
    expect(channels.map((one) => [one.channel, one.target, one.label, one.cadence])).toEqual([
      ["slack", "https://hooks.slack.com/services/T/B/x", "#leads in AnyAPI", "hourly"],
    ]);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("refuses a Discord return whose state is not the one it sent, and says so on settings", async () => {
    const { user, project, db, schema } = await person();
    const start = await import("@/app/connect/discord/route");
    const callback = await import("@/app/connect/discord/callback/route");
    const { listChannels } = await import("@/lib/alerts/channels");

    const out = await start.GET(new NextRequest(`https://lurk.so/connect/discord?project=${project.id}`));
    expect(new URL(out.headers.get("location") ?? "").origin).toBe("https://discord.com");
    const cookie = setCookie(out, "discord_oauth");
    expect(cookie).not.toBeNull();

    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const back = await callback.GET(
      new NextRequest("https://lurk.so/connect/discord/callback?code=c&state=forged", {
        headers: { cookie: `discord_oauth=${cookie}` },
      }),
    );
    expect(back.headers.get("location")).toBe(
      `https://lurk.so/app/settings/alerts?discord=failed&project=${project.id}`,
    );
    expect(fetched).not.toHaveBeenCalled();
    expect(await listChannels(project.id)).toEqual([]);

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });

  it("sends a project that is not the caller's back to settings without leaving", async () => {
    const { user, db, schema } = await person();
    const start = await import("@/app/connect/slack/route");

    const out = await start.GET(new NextRequest("https://lurk.so/connect/slack?project=not-mine"));
    expect(out.headers.get("location")).toBe("https://lurk.so/app/settings/alerts");
    expect(setCookie(out, "slack_oauth")).toBeNull();

    await db().delete(schema.users).where(eq(schema.users.id, user.id));
  });
});
