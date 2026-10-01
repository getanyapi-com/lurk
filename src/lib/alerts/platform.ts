import { sameWords } from "./select";
import type { Digest, DigestLead, LeadPlatform } from "./types";

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

/** What every message, email or chat, says about the leads one window held. */

export function windowPhrase(digest: Pick<Digest, "cadence">): string {
  return digest.cadence === "hourly" ? "in the last hour" : "in the last 24 hours";
}

/** Every lead the window held, listed or not. A chat message lists five of thirty. */
export function totalOf(digest: Pick<Digest, "leads" | "more">): number {
  return digest.leads.length + (digest.more ?? 0);
}

/** "1 new lead", "30 new leads". */
export function newLeadsPhrase(count: number): string {
  return `${count} new ${count === 1 ? "lead" : "leads"}`;
}

/** The line a message opens with, counting every lead the window held. */
export function headlineOf(digest: Digest): string {
  return `${newLeadsPhrase(totalOf(digest))} for ${digest.projectName}, found ${windowPhrase(digest)}.`;
}

/** How a message names the tab where the leads it left out are listed. */
export const MORE_LINK: Record<LeadPlatform, string> = { reddit: "in the feed", x: "in X leads" };

/**
 * Where "the rest" are listed: the tab of each platform the message left leads
 * out on, which is not always one it lists. A digest built without that says
 * the platforms it lists.
 */
function leftoverPlatforms(digest: Digest): LeadPlatform[] {
  return digest.morePlatforms?.length ? digest.morePlatforms : platformsOf(digest.leads);
}

/**
 * "And 25 more in the feed and in X leads.", each place as `place` writes it,
 * which is a link in every channel that has them. Null when the message lists
 * every lead the window held.
 */
export function moreLine(digest: Digest, place: (platform: LeadPlatform) => string): string | null {
  if (!digest.more) {
    return null;
  }
  return `And ${digest.more} more ${leftoverPlatforms(digest).map(place).join(" and ")}.`;
}

/**
 * What a message quotes under a lead's title, one rule for the email and every
 * chat: the line that made it a lead, unless it only repeats the title, and
 * otherwise the author's own words. The phrase is the evidence and reads in a
 * line; the excerpt is the fallback for a lead whose phrase says nothing new.
 */
export type LeadQuote = { kind: "phrase" | "excerpt"; text: string };

export function quoteOf(lead: Pick<DigestLead, "title" | "matchedPhrase" | "excerpt">): LeadQuote | null {
  if (lead.matchedPhrase && !sameWords(lead.matchedPhrase, lead.title)) {
    return { kind: "phrase", text: lead.matchedPhrase };
  }
  return lead.excerpt ? { kind: "excerpt", text: lead.excerpt } : null;
}

/** The quote as plain text: a phrase in quotation marks, as the email sets it, an excerpt as it is. */
export function quoteText(lead: Pick<DigestLead, "title" | "matchedPhrase" | "excerpt">): string | null {
  const quote = quoteOf(lead);
  if (!quote) {
    return null;
  }
  return quote.kind === "phrase" ? `“${quote.text}”` : quote.text;
}

/** The platforms a message carries, Reddit first; Reddit alone when it carries nothing. */
export function platformsOf(leads: Pick<DigestLead, "platform">[]): LeadPlatform[] {
  const carried = (["reddit", "x"] as const).filter((platform) =>
    leads.some((lead) => lead.platform === platform),
  );
  return carried.length > 0 ? carried : ["reddit"];
}

/** What each of an alert's two links says. */
export const REPLIED_LABEL = "Mark replied";

export function muteLabel(lead: Pick<DigestLead, "subreddit">): string {
  return `Mute r/${lead.subreddit}`;
}

/** An alert's links for one lead, as label and address, in the order they are shown. */
export function actLinksOf(lead: Pick<DigestLead, "subreddit" | "repliedUrl" | "muteUrl">): { label: string; url: string }[] {
  return [
    ...(lead.repliedUrl ? [{ label: REPLIED_LABEL, url: lead.repliedUrl }] : []),
    ...(lead.muteUrl ? [{ label: muteLabel(lead), url: lead.muteUrl }] : []),
  ];
}
