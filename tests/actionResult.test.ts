import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ACTION_FAILED, errorFrom } from "@/lib/actionError";
import { errorMessage, failure } from "@/lib/actionResult";

/**
 * A production build hides any message a Server Action throws behind a generic
 * sentence, so an action whose refusal is meant for the person returns it as
 * `{ error }`. What has to hold: the refusal arrives as the sentence it was
 * written as, nothing meant for a debugger (SQL, a schema's JSON) arrives at
 * all, and Next's own redirect is never swallowed into a message.
 */

let signedIn: { id: string } = { id: "" };
vi.mock("@/lib/auth", () => ({ requireLocalUser: async () => signedIn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("what a caught error says", () => {
  it("is the error's own sentence", () => {
    expect(failure(new Error("A Discord webhook URL is on discord.com"))).toEqual({
      error: "A Discord webhook URL is on discord.com",
    });
  });

  it("is the fallback for a failed statement or something that is not an Error", () => {
    expect(failure(new Error('Failed query: insert into "alerts" values ($1)'), "Nothing was saved.")).toEqual({
      error: "Nothing was saved.",
    });
    expect(errorMessage("a string", "Nothing was saved.")).toBe("Nothing was saved.");
  });

  it("is a schema's first complaint, not its JSON", () => {
    const parsed = z.object({ hours: z.number().int().positive() }).safeParse({ hours: 0 });
    expect(parsed.success).toBe(false);
    expect(errorMessage(parsed.error, "fallback")).toBe(parsed.error?.issues[0]?.message);
    expect(errorMessage(parsed.error, "fallback")).not.toContain("{");
  });

  it("throws Next's redirect on instead of reporting it", () => {
    let thrown: unknown;
    try {
      redirect("/sign-in");
    } catch (error) {
      thrown = error;
    }
    expect(() => failure(thrown)).toThrow();
  });
});

/**
 * Some failures still throw past an action's catch: a dropped connection, an
 * action a deploy replaced, a refusal thrown before the try. A throw from a
 * form action replaces the page with the error screen, so the form catches it
 * and says a sentence of its own, and only a redirect goes on to the router.
 */
describe("what a form shows from an action", () => {
  it("is the sentence the action returned, or nothing", async () => {
    expect(await errorFrom(async () => ({ error: "Pick a channel" }))).toBe("Pick a channel");
    expect(await errorFrom(async () => ({ error: null }))).toBeNull();
  });

  it("is a sentence of its own when the action throws", async () => {
    expect(
      await errorFrom(async () => {
        throw new Error("Failed to fetch");
      }),
    ).toBe(ACTION_FAILED);
  });

  it("throws a redirect on for the router", async () => {
    await expect(
      errorFrom(async () => {
        redirect("/sign-in");
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("actions that refuse, against a database", () => {
  async function owned() {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
    const { db } = await import("@/db");
    const schema = await import("@/db/schema");
    const [user] = await db()
      .insert(schema.users)
      .values({ clerkUserId: `test_${randomUUID()}` })
      .returning();
    const [project] = await db()
      .insert(schema.projects)
      .values({ userId: user.id, name: "Formcraft" })
      .returning();
    signedIn = { id: user.id };
    return project;
  }

  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      data.set(name, value);
    }
    return data;
  }

  it("returns why a channel was refused, and nothing when it was added", async () => {
    const { addChannelAction } = await import("@/app/app/settings/alerts/actions");
    const project = await owned();

    expect(
      await addChannelAction(project.id, form({ channel: "discord", target: "https://example.com/hook" })),
    ).toEqual({ error: "A Discord webhook URL is on discord.com" });
    expect(await addChannelAction(project.id, form({ channel: "pager" }))).toEqual({ error: "Pick a channel" });
    expect(
      await addChannelAction(project.id, form({ channel: "email", target: "you@company.com" })),
    ).toEqual({ error: null });
    expect(
      await addChannelAction(project.id, form({ channel: "email", target: "you@company.com" })),
    ).toEqual({ error: "That channel is already on this project" });
  });

  it("asks for a reason before it marks a lead not a fit", async () => {
    const { markNotFitAction } = await import("@/app/app/leads/actions");
    const project = await owned();

    expect(await markNotFitAction(project.id, randomUUID(), form({ reason: " " }))).toEqual({
      error: "Pick a reason before marking a lead as not a fit",
    });
  });

  it("returns why a mute was refused", async () => {
    const { addMuteAction } = await import("@/app/app/settings/alerts/actions");
    const project = await owned();

    expect(await addMuteAction(project.id, form({ kind: "keyword", value: "!!!" }))).toEqual({
      error: "Type a word or a phrase to mute",
    });
    expect(await addMuteAction(project.id, form({ kind: "subreddit", value: "r/SaaS" }))).toEqual({ error: null });
  });
});
