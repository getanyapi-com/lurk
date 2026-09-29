import type { DigestLead, LeadPlatform } from "./types";

/** How each platform's lead is named in a message. Reddit's words are the ones every alert used before X. */

/** "u/name" on Reddit, "@name" on X. */
export function handleOf(lead: Pick<DigestLead, "platform" | "author">): string {
  const name = lead.author ?? "unknown";
  return lead.platform === "x" ? `@${name}` : `u/${name}`;
}

/** Where the post sits: its subreddit, or X, which has none. */
export function venueOf(lead: Pick<DigestLead, "platform" | "subreddit">): string {
  return lead.platform === "x" ? "X" : `r/${lead.subreddit}`;
}

/** "12 comments" under a Reddit post, "12 replies" under a post on X. */
export function repliesPhrase(count: number, platform: LeadPlatform): string {
  return platform === "x"
    ? `${count} ${count === 1 ? "reply" : "replies"}`
    : `${count} ${count === 1 ? "comment" : "comments"}`;
}

/**
 * Whether an alert prints the lead's score. Reddit's is the lead model's, in
 * the feed's colours. An X ask's only orders asks (src/lib/x/gates.ts
 * `foldScore`) and on Reddit's scale a qualified ask reads as a weak lead, so
 * the X tab never shows it and neither does an alert.
 */
export function showsScore(lead: Pick<DigestLead, "platform">): boolean {
  return lead.platform === "reddit";
}

/** What a chat message says in the score's place on X. */
export const X_ASK_LABEL = "X ask";

/** The platform's name, and the badge an email sets on a face (public/email). */
export const PLATFORM_NAME: Record<LeadPlatform, string> = { reddit: "Reddit", x: "X" };
export const PLATFORM_ICON: Record<LeadPlatform, string> = { reddit: "reddit.png", x: "x.png" };

/** The tab each platform's leads are listed in. */
export const FEED_PATH: Record<LeadPlatform, string> = { reddit: "/app/leads", x: "/app/x" };

/** The platforms a message carries, Reddit first; Reddit alone when it carries nothing. */
export function platformsOf(leads: Pick<DigestLead, "platform">[]): LeadPlatform[] {
  const carried = (["reddit", "x"] as const).filter((platform) =>
    leads.some((lead) => lead.platform === platform),
  );
  return carried.length > 0 ? carried : ["reddit"];
}
