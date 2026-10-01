import { and, avg, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  leads,
  painThemes,
  redditAuthors,
  redditComments,
  redditPosts,
  subreddits,
} from "@/db/schema";
import { LEAD_AUTHOR, LEAD_AUTHOR_JOIN } from "@/lib/leadSql";
import { themeLinkLeads } from "@/lib/leads";

/** How many faces a theme card shows before it stops. */
export const THEME_FACES = 5;

export type ThemeFace = { name: string | null; avatarUrl: string | null };

export type ThemeCommunity = { name: string; iconUrl: string | null };

export type ThemeView = {
  id: string;
  label: string;
  summary: string | null;
  count: number;
  faces: ThemeFace[];
  quotes: string[];
  communities: ThemeCommunity[];
  generatedAt: Date;
};

export type CommunityRow = {
  name: string;
  iconUrl: string | null;
  leads: number;
  averageScore: number;
  promoPolicy: string | null;
  weeklyActiveUsers: number | null;
};

/** One lead as a theme card reads it: who said it, what they said, and where. */
type LeadFact = { face: ThemeFace; phrase: string | null; community: ThemeCommunity };

export type ThemeQuoteRow = { themeId: string; phrase: string | null };

/**
 * The words behind each theme, keyed by theme id. A lead whose matched phrase
 * is empty said nothing worth printing, so it is dropped rather than shown as a
 * blank quote, and one phrase two leads share is quoted once.
 */
export function themeQuotes(rows: ThemeQuoteRow[]): Map<string, string[]> {
  const byTheme = new Map<string, string[]>();
  for (const row of rows) {
    const phrase = row.phrase?.trim();
    if (!phrase) {
      continue;
    }
    const quotes = byTheme.get(row.themeId) ?? [];
    if (!quotes.includes(phrase)) {
      quotes.push(phrase);
    }
    byTheme.set(row.themeId, quotes);
  }
  return byTheme;
}

/**
 * Where the feed is, narrowed to one theme. The card and the feed agree on the
 * shape of that link in one place, so neither can drift into a dead link.
 */
export function themeHref(projectId: string, themeId: string): string {
  return `/app/leads?project=${encodeURIComponent(projectId)}&theme=${encodeURIComponent(themeId)}`;
}

/** Who is behind a set of leads, what they said, and which community they said it in. */
async function factsFor(leadIds: string[]): Promise<Map<string, LeadFact>> {
  if (leadIds.length === 0) {
    return new Map();
  }
  const rows = await db()
    .select({
      id: leads.id,
      author: LEAD_AUTHOR,
      avatarUrl: redditAuthors.avatarUrl,
      matchedPhrase: leads.matchedPhrase,
      subreddit: redditPosts.subreddit,
      subredditIconUrl: subreddits.iconUrl,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .leftJoin(redditAuthors, LEAD_AUTHOR_JOIN)
    .where(inArray(leads.id, leadIds));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        face: { name: row.author, avatarUrl: row.avatarUrl },
        phrase: row.matchedPhrase,
        community: { name: row.subreddit, iconUrl: row.subredditIconUrl },
      },
    ]),
  );
}

/** The communities a theme's leads came from, the busiest one first. */
function communitiesOf(leadIds: string[], facts: Map<string, LeadFact>): ThemeCommunity[] {
  const seen = new Map<string, { community: ThemeCommunity; leads: number }>();
  for (const id of leadIds) {
    const community = facts.get(id)?.community;
    if (!community) {
      continue;
    }
    const row = seen.get(community.name) ?? { community, leads: 0 };
    row.leads += 1;
    seen.set(community.name, row);
  }
  return [...seen.values()].sort((a, b) => b.leads - a.leads).map((row) => row.community);
}

/**
 * The stored themes with their faces, quotes and communities, biggest first.
 * A card quotes the same leads it shows faces for, so the two halves of the
 * card describe one set of people rather than two.
 *
 * A theme keeps the leads it was grouped from, and a card describes only those
 * its link opens the feed on: one triaged, muted or filtered out since the
 * grouping leaves the count, the faces, the quotes and the communities, so the
 * number on the card is the number of rows the link shows. The theme itself
 * stays until the next grouping, which decides what the leads have in common.
 */
export async function listThemes(projectId: string): Promise<ThemeView[]> {
  const rows = await db()
    .select()
    .from(painThemes)
    .where(eq(painThemes.projectId, projectId))
    .orderBy(desc(painThemes.generatedAt));
  const opened = await themeLinkLeads(
    projectId,
    rows.map((row) => ({ id: row.id, leadIds: row.leadIds ?? [] })),
  );
  const themes = rows.map((row) => ({ ...row, leadIds: opened.get(row.id) ?? [] }));
  const facts = await factsFor(themes.flatMap((theme) => theme.leadIds));
  const quotes = themeQuotes(
    themes.flatMap((theme) =>
      theme.leadIds
        .slice(0, THEME_FACES)
        .map((id) => ({ themeId: theme.id, phrase: facts.get(id)?.phrase ?? null })),
    ),
  );
  return themes
    .map((theme) => ({
      id: theme.id,
      label: theme.label,
      summary: theme.summary,
      count: theme.leadIds.length,
      faces: theme.leadIds
        .slice(0, THEME_FACES)
        .map((id) => facts.get(id)?.face)
        .filter((face): face is ThemeFace => face !== undefined),
      quotes: quotes.get(theme.id) ?? [],
      communities: communitiesOf(theme.leadIds, facts),
      generatedAt: theme.generatedAt,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Where this project's leads come from, and what each community allows. */
export async function listCommunities(projectId: string): Promise<CommunityRow[]> {
  const rows = await db()
    .select({
      name: redditPosts.subreddit,
      iconUrl: subreddits.iconUrl,
      leads: count(),
      averageScore: avg(leads.score),
      promoPolicy: subreddits.promoPolicy,
      weeklyActiveUsers: subreddits.subscribers,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .where(and(eq(leads.projectId, projectId), inArray(leads.status, ["new", "hidden"])))
    .groupBy(
      redditPosts.subreddit,
      subreddits.iconUrl,
      subreddits.promoPolicy,
      subreddits.subscribers,
    );
  return rows
    .map((row) => ({
      name: row.name,
      iconUrl: row.iconUrl,
      leads: row.leads,
      averageScore: Math.round(Number(row.averageScore ?? 0)),
      promoPolicy: row.promoPolicy,
      weeklyActiveUsers: row.weeklyActiveUsers,
    }))
    .sort((a, b) => b.leads - a.leads);
}
