import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { leadMutes, leads, redditComments, redditPosts, xLeads, xPosts } from "@/db/schema";
import { forgetProjectFeed } from "@/lib/projectFeedCache";

export type MuteKind = "keyword" | "subreddit";

export type Mute = { id: string; kind: MuteKind; value: string };

export function isMuteKind(value: string): value is MuteKind {
  return value === "keyword" || value === "subreddit";
}

/** Longer than this is a sentence, not a keyword, and would match nothing. */
const MAX_KEYWORD_LENGTH = 80;

/**
 * A keyword as whole words: lowercase, every run of anything but letters and
 * digits one space. The text it is matched against is folded the same way in
 * SQL (`WORDS_OF`), so "Zapier" mutes "zapier's" and "zapier," but not
 * "zapierlike", and "no code" mutes "no-code".
 */
export function keywordWords(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A subreddit as it is typed, pasted or linked: r/SaaS, /r/saas/, reddit.com/r/SaaS. */
export function subredditName(text: string): string {
  const trimmed = text.trim().replace(/\/+$/, "");
  const linked = trimmed.match(/(?:^|\/)r\/([A-Za-z0-9_]+)$/);
  return (linked ? linked[1] : trimmed).toLowerCase();
}

/** What is stored for what the person typed, or null when there is nothing to mute. */
export function muteValue(kind: MuteKind, text: string): string | null {
  if (kind === "subreddit") {
    const name = subredditName(text);
    return /^[a-z0-9_]{2,21}$/.test(name) ? name : null;
  }
  const words = keywordWords(text);
  return words.length > 0 && words.length <= MAX_KEYWORD_LENGTH ? words : null;
}

export async function listMutes(projectId: string): Promise<Mute[]> {
  const rows = await db()
    .select({ id: leadMutes.id, kind: leadMutes.kind, value: leadMutes.value })
    .from(leadMutes)
    .where(eq(leadMutes.projectId, projectId))
    .orderBy(asc(leadMutes.kind), asc(leadMutes.value));
  return rows.filter((row): row is Mute => isMuteKind(row.kind));
}

/** Adds a mute, and says what was stored. Muting the same thing twice is one mute. */
export async function addMute(projectId: string, kind: MuteKind, text: string): Promise<string> {
  const value = muteValue(kind, text);
  if (!value) {
    throw new Error(kind === "subreddit" ? "That is not a subreddit name" : "Type a word or a phrase to mute");
  }
  await db().insert(leadMutes).values({ projectId, kind, value }).onConflictDoNothing();
  forgetProjectFeed(projectId);
  return value;
}

export async function removeMute(projectId: string, muteId: string): Promise<void> {
  await db()
    .delete(leadMutes)
    .where(and(eq(leadMutes.projectId, projectId), eq(leadMutes.id, muteId)));
  forgetProjectFeed(projectId);
}

/** Removes a mute by what it mutes, for the undo on the page an alert's link opens. */
export async function removeMuteValue(projectId: string, kind: MuteKind, value: string): Promise<void> {
  await db()
    .delete(leadMutes)
    .where(and(eq(leadMutes.projectId, projectId), eq(leadMutes.kind, kind), eq(leadMutes.value, value)));
  forgetProjectFeed(projectId);
}

/** Text folded into words between spaces, the SQL twin of `keywordWords`, padded so a keyword matches whole. */
function wordsOf(text: SQL): SQL {
  return sql`(' ' || regexp_replace(lower(${text}), '[^[:alnum:]]+', ' ', 'g') || ' ')`;
}

/**
 * True when no mute of the project touches the lead: its subreddit is not
 * muted and none of the muted keywords appears in its words. The folding only
 * runs when the project has a keyword mute, so a project with none pays for
 * one empty index lookup per row.
 */
export function notMuted(projectId: SQL, words: SQL, subreddit: SQL | null): SQL {
  const bySubreddit = subreddit
    ? sql`(m.kind = 'subreddit' and m.value = lower(${subreddit}))`
    : sql`false`;
  return sql`not exists (
    select 1 from ${leadMutes} m
    where m.project_id = ${projectId}
      and (${bySubreddit}
        or (m.kind = 'keyword' and strpos(${wordsOf(words)}, ' ' || m.value || ' ') > 0))
  )`;
}

/**
 * A Reddit lead no mute touches, read over the lead joined to its post and,
 * left, its comment. The words are the thread's title and what the lead's own
 * author wrote, so a muted word in the title silences the replies under it too.
 */
export function redditLeadNotMuted(): SQL {
  return notMuted(
    sql`${leads.projectId}`,
    sql`${redditPosts.title} || ' ' || coalesce(${redditComments.body}, ${redditPosts.body}, '')`,
    sql`${redditPosts.subreddit}`,
  );
}

/** An X lead no keyword mute touches, over the lead joined to its post. X has no subreddit. */
export function xLeadNotMuted(): SQL {
  return notMuted(sql`${xLeads.projectId}`, sql`${xPosts.text}`, null);
}
