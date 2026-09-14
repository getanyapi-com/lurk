import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitorMentions } from "@/db/schema/competitors";
import { projectCompetitors, redditAuthors, redditPosts, subreddits } from "@/db/schema";
import { SENTIMENTS, type Sentiment } from "./classify";

/** The window the competitor screen shows, matching the feed window. */
export const MENTION_WINDOW_DAYS = 30;

export type MentionView = {
  id: string;
  competitor: string;
  sentiment: Sentiment;
  summary: string | null;
  foundAt: Date;
  postId: string;
  title: string;
  url: string;
  subreddit: string;
  subredditIconUrl: string | null;
  author: string | null;
  avatarUrl: string | null;
  createdAt: Date;
};

/** The competitors this project watches, in the order they were added. */
export async function listCompetitorNames(projectId: string): Promise<string[]> {
  const rows = await db()
    .select({ name: projectCompetitors.name })
    .from(projectCompetitors)
    .where(eq(projectCompetitors.projectId, projectId));
  return rows.map((row) => row.name);
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

/** Every mention inside the window, newest first. */
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
      foundAt: competitorMentions.foundAt,
      postId: competitorMentions.postId,
      title: redditPosts.title,
      url: redditPosts.url,
      subreddit: redditPosts.subreddit,
      subredditIconUrl: subreddits.iconUrl,
      author: redditPosts.author,
      avatarUrl: redditAuthors.avatarUrl,
      createdAt: redditPosts.createdAt,
    })
    .from(competitorMentions)
    .innerJoin(redditPosts, eq(redditPosts.id, competitorMentions.postId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .leftJoin(redditAuthors, eq(redditAuthors.username, sql`lower(${redditPosts.author})`))
    .where(
      and(
        eq(competitorMentions.projectId, projectId),
        gte(redditPosts.createdAt, windowStart(days)),
      ),
    )
    .orderBy(desc(redditPosts.createdAt));
  return rows.map((row) => ({ ...row, sentiment: row.sentiment as Sentiment }));
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
    row.sentiments[mention.sentiment] += 1;
  }
  return [...counts.values()].sort((a, b) => b.total - a.total);
}
