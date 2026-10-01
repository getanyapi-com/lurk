import { isThreadPlatform, type ThreadPlatform } from "@/lib/handled";
import { signToken, verifyToken } from "./signedLink";
import type { DigestLead } from "./types";

/**
 * What a link in an alert may do, and to what: mark one thread replied, or mute
 * one community. Each names its project, so a token can never reach past it.
 */
export type AlertAct =
  | { act: "replied"; projectId: string; platform: ThreadPlatform; threadId: string }
  | { act: "mute"; projectId: string; subreddit: string };

/** What an act's link is signed for; its payload is the act's fields, a line each, in base64url. */
const ACT_PURPOSE = "alert-act";

function fieldsOf(act: AlertAct): string[] {
  return act.act === "replied"
    ? [act.act, act.projectId, act.platform, act.threadId]
    : [act.act, act.projectId, act.subreddit];
}

/**
 * A link token for one act that cannot be forged without the app key. Like the
 * invite's it does not expire: a digest read a week late should still work,
 * and all it can do is take leads out of that one project's alerts.
 */
export function actToken(act: AlertAct): string {
  return signToken(ACT_PURPOSE, Buffer.from(fieldsOf(act).join("\n")).toString("base64url"));
}

/** The act a token names, or null when it was altered or never issued. */
export function actForToken(token: string): AlertAct | null {
  const payload = verifyToken(ACT_PURPOSE, token);
  if (payload === null) {
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
  return `${appUrl}/alerts/act?t=${encodeURIComponent(actToken(act))}`;
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
