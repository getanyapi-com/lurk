import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { isThreadPlatform, type ThreadPlatform } from "@/lib/handled";
import type { DigestLead } from "./types";

/**
 * What a link in an alert may do, and to what: mark one thread replied, or mute
 * one community. Each names its project, so a token can never reach past it.
 */
export type AlertAct =
  | { act: "replied"; projectId: string; platform: ThreadPlatform; threadId: string }
  | { act: "mute"; projectId: string; subreddit: string };

function signingKey(): Buffer {
  return Buffer.from(config().APP_ENCRYPTION_KEY, "base64");
}

function fieldsOf(act: AlertAct): string[] {
  return act.act === "replied"
    ? [act.act, act.projectId, act.platform, act.threadId]
    : [act.act, act.projectId, act.subreddit];
}

function signatureFor(payload: string): string {
  return createHmac("sha256", signingKey()).update(`alert-act:${payload}`).digest("base64url");
}

/**
 * A link token for one act that cannot be forged without the app key. Like the
 * invite's it does not expire: a digest read a week late should still work,
 * and all it can do is take leads out of that one project's alerts.
 */
export function actToken(act: AlertAct): string {
  const payload = Buffer.from(fieldsOf(act).join("\n")).toString("base64url");
  return `${payload}.${signatureFor(payload)}`;
}

/** The act a token names, or null when it was altered or never issued. */
export function actForToken(token: string): AlertAct | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signatureFor(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  const [act, projectId, ...rest] = Buffer.from(payload, "base64url").toString().split("\n");
  if (act === "replied" && rest.length === 2 && isThreadPlatform(rest[0])) {
    return { act, projectId, platform: rest[0], threadId: rest[1] };
  }
  if (act === "mute" && rest.length === 1) {
    return { act, projectId, subreddit: rest[0] };
  }
  return null;
}

/** Where a link in an alert lands. The page, not the visit, does the act (app/alerts/act). */
export function actUrl(appUrl: string, act: AlertAct): string {
  return `${appUrl.replace(/\/$/, "")}/alerts/act?t=${encodeURIComponent(actToken(act))}`;
}

/**
 * The leads of one message with their two links: Replied for the thread each
 * sits in, and on Reddit a mute for its community. A lead with no thread is its
 * own thread.
 */
export function withActLinks(leads: DigestLead[], projectId: string, appUrl: string): DigestLead[] {
  return leads.map((lead) => ({
    ...lead,
    repliedUrl: actUrl(appUrl, {
      act: "replied",
      projectId,
      platform: lead.platform,
      threadId: lead.threadId ?? lead.id,
    }),
    muteUrl: lead.subreddit ? actUrl(appUrl, { act: "mute", projectId, subreddit: lead.subreddit }) : undefined,
  }));
}
