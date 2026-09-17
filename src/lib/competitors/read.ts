import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitorMentions } from "@/db/schema/competitors";
import {
  projectCompetitors,
  redditAuthors,
  redditComments,
  redditPosts,
  subreddits,
} from "@/db/schema";
import { SENTIMENTS, type Sentiment } from "./classify";

/** The window the competitor screen shows, matching the feed window. */
export const MENTION_WINDOW_DAYS = 30;

export type MentionView = {
  id: string;
  competitor: string;
  /** Null for a mention found in a thread the project reads, which nobody judged. */
  sentiment: Sentiment | null;
  summary: string | null;
  /** The sentence that named the competitor, for a mention found in a thread. */
  quote: string | null;
  foundAt: Date;
  postId: string;
  title: string;
  /** The reply's own link when a reply named the competitor, else the post's. */
  url: string;
  subreddit: string;
  subredditIconUrl: string | null;
  /** Who named the competitor: the reply's author, or the post's. */
  author: string | null;
  avatarUrl: string | null;
  createdAt: Date;
};

/** A competitor as the screen draws it: a name, and the site its logo comes from. */
export type CompetitorRow = { name: string; domain: string | null };

/** The competitors this project watches, in the order they were added. */
export async function listCompetitors(projectId: string): Promise<CompetitorRow[]> {
  return await db()
    .select({ name: projectCompetitors.name, domain: projectCompetitors.domain })
    .from(projectCompetitors)
    .where(eq(projectCompetitors.projectId, projectId));
}

/** The same competitors as bare names, for the judgements that read prose. */
export async function listCompetitorNames(projectId: string): Promise<string[]> {
  const rows = await listCompetitors(projectId);
  return rows.map((row) => row.name);
}

/**
 * The site each competitor sells from, keyed by name. A name discovery never
 * found a site for still answers, with null, so the chip can fall back to the
 * name itself being a domain.
 */
export function domainsByName(rows: CompetitorRow[]): Record<string, string | null> {
  return Object.fromEntries(rows.map((row) => [row.name, row.domain]));
}

function windowStart(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * How many mentions are in the window. The rail's pill wants the number and
 * nothing else, and asking the database to count is a great deal less work
 * than reading every mention with its thread, its author and its icon on every
 * page of the app.
 */
export async function countMentions(
  projectId: string,
  days = MENTION_WINDOW_DAYS,
): Promise<number> {
  const rows = await db()
    .select({ total: count() })
    .from(competitorMentions)
    .innerJoin(redditPosts, eq(redditPosts.id, competitorMentions.postId))
    .where(
      and(
        eq(competitorMentions.projectId, projectId),
        gte(redditPosts.createdAt, windowStart(days)),
      ),
    );
  return rows[0]?.total ?? 0;
}

/** The one who named the competitor: the reply's author when a reply did. */
const NAMED_BY = sql`coalesce(${redditComments.author}, ${redditPosts.author})`;

/** Every mention inside the window, newest first. A reply is as old as itself. */
export async function listMentions(
  projectId: string,
  days = MENTION_WINDOW_DAYS,
): Promise<MentionView[]> {
  const rows = await db()
    .select({
      id: competitorMentions.id,
      competitor: competitorMentions.competitor,
      sentiment: competitorMentions.sentiment,
      summary: competitorMentions.summary,
      quote: competitorMentions.quote,
      foundAt: competitorMentions.foundAt,
      postId: competitorMentions.postId,
      title: redditPosts.title,
      url: sql<string>`coalesce(${redditComments.permalink}, ${redditPosts.url})`,
      subreddit: redditPosts.subreddit,
      subredditIconUrl: subreddits.iconUrl,
      author: sql<string | null>`${NAMED_BY}`,
      avatarUrl: redditAuthors.avatarUrl,
      createdAt: sql<Date>`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`,
    })
    .from(competitorMentions)
    .innerJoin(redditPosts, eq(redditPosts.id, competitorMentions.postId))
    .leftJoin(redditComments, eq(redditComments.id, competitorMentions.commentId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .leftJoin(redditAuthors, eq(redditAuthors.username, sql`lower(${NAMED_BY})`))
    .where(
      and(
        eq(competitorMentions.projectId, projectId),
        gte(redditPosts.createdAt, windowStart(days)),
      ),
    )
    .orderBy(desc(sql`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`));
  return rows.map((row) => ({
    ...row,
    sentiment: (row.sentiment as Sentiment | null) ?? null,
    createdAt: new Date(row.createdAt),
  }));
}

/**
 * The competitors named anywhere in one thread this project holds a lead in,
 * each once, in the order the project lists them. The detail pane's line.
 */
export async function competitorsNamedIn(projectId: string, postId: string): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ competitor: competitorMentions.competitor })
    .from(competitorMentions)
    .where(
      and(eq(competitorMentions.projectId, projectId), eq(competitorMentions.postId, postId)),
    );
  const named = new Set(rows.map((row) => row.competitor));
  const listed = await listCompetitorNames(projectId);
  return listed.filter((name) => named.has(name));
}

export type MentionSeries = { competitor: string; days: number[]; total: number };

/**
 * One bar per day per competitor, oldest day first, so a row of bars reads
 * left to right as the last thirty days.
 */
export function mentionSeries(
  mentions: Pick<MentionView, "competitor" | "createdAt">[],
  competitors: string[],
  days = MENTION_WINDOW_DAYS,
  now = new Date(),
): MentionSeries[] {
  const start = windowStart(days, now).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, number[]>();
  const names = [...new Set([...competitors, ...mentions.map((one) => one.competitor)])];
  for (const name of names) {
    buckets.set(name, new Array(days).fill(0));
  }
  for (const mention of mentions) {
    const index = Math.floor((mention.createdAt.getTime() - start) / dayMs);
    const row = buckets.get(mention.competitor);
    if (row && index >= 0 && index < days) {
      row[index] += 1;
    }
  }
  return names.map((competitor) => {
    const row = buckets.get(competitor) as number[];
    return { competitor, days: row, total: row.reduce((sum, one) => sum + one, 0) };
  });
}

export type CompetitorCount = {
  competitor: string;
  total: number;
  sentiments: Record<Sentiment, number>;
};

/**
 * How often each competitor was mentioned, split by sentiment, loudest first.
 * A mention found in a thread has no sentiment and counts in the total only.
 * Competitors tied on total keep the order they were first mentioned in.
 */
export function topCompetitors(
  mentions: Pick<MentionView, "competitor" | "sentiment">[],
): CompetitorCount[] {
  const counts = new Map<string, CompetitorCount>();
  for (const mention of mentions) {
    let row = counts.get(mention.competitor);
    if (!row) {
      const sentiments = Object.fromEntries(
        SENTIMENTS.map((name) => [name, 0]),
      ) as Record<Sentiment, number>;
      row = { competitor: mention.competitor, total: 0, sentiments };
      counts.set(mention.competitor, row);
    }
    row.total += 1;
    if (mention.sentiment !== null) {
      row.sentiments[mention.sentiment] += 1;
    }
  }
  return [...counts.values()].sort((a, b) => b.total - a.total);
}
