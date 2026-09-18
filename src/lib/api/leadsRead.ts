import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, projects, redditComments, redditPosts } from "@/db/schema";
import { leadCosts } from "@/lib/leads";
import { LEAD_URL, leadsSelect, type LeadQuery } from "./leadsQuery";

export type ApiLead = {
  id: string;
  postId: string | null;
  commentId: string | null;
  title: string;
  subreddit: string;
  author: string | null;
  url: string;
  score: number;
  stage: string | null;
  reason: string | null;
  matchedPhrase: string | null;
  sellerSide: boolean;
  status: string;
  postedAt: string;
  scoredAt: string;
  costUsd: number | null;
  body?: string | null;
};

type Row = {
  id: string;
  postId: string | null;
  commentId: string | null;
  title: string;
  subreddit: string;
  postAuthor: string | null;
  commentAuthor: string | null;
  url: string;
  score: number;
  stage: string | null;
  reason: string | null;
  matchedPhrase: string | null;
  sellerSide: boolean;
  status: string;
  postedAt: Date;
  scoredAt: Date;
  body: string | null;
};

function shape(row: Row, costUsd: number | null, includeBody: boolean): ApiLead {
  const lead: ApiLead = {
    id: row.id,
    postId: row.postId,
    commentId: row.commentId,
    title: row.title,
    subreddit: row.subreddit,
    author: row.commentAuthor ?? row.postAuthor,
    url: row.url,
    score: row.score,
    stage: row.stage,
    reason: row.reason,
    matchedPhrase: row.matchedPhrase,
    sellerSide: row.sellerSide,
    status: row.status,
    postedAt: new Date(row.postedAt).toISOString(),
    scoredAt: new Date(row.scoredAt).toISOString(),
    costUsd,
  };
  return includeBody ? { ...lead, body: row.body } : lead;
}

async function costsFor(projectId: string, rows: Row[]): Promise<Map<string, number>> {
  const postIds = rows.map((row) => row.postId).filter((id): id is string => id !== null);
  const costs = await leadCosts(projectId, postIds);
  return new Map([...costs].map(([postId, cost]) => [postId, cost.costUsd]));
}

export type LeadPage = { leads: ApiLead[]; pagination: { limit: number; offset: number; hasMore: boolean } };

/** One page of a project's leads, best first, each with what its data cost. */
export async function listApiLeads(
  projectId: string,
  query: LeadQuery,
  feedWindowDays: number,
): Promise<LeadPage> {
  const rows = (await leadsSelect(projectId, query, feedWindowDays)) as Row[];
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const costs = await costsFor(projectId, page);
  return {
    leads: page.map((row) =>
      shape(row, row.postId ? (costs.get(row.postId) ?? null) : null, query.includeBody),
    ),
    pagination: { limit: query.limit, offset: query.offset, hasMore },
  };
}

/** One lead of the caller's, with its body, or null when it is not theirs. */
export async function getApiLead(userId: string, leadId: string): Promise<ApiLead | null> {
  const rows = (await db()
    .select({
      id: leads.id,
      postId: leads.postId,
      commentId: leads.commentId,
      projectId: leads.projectId,
      title: redditPosts.title,
      subreddit: redditPosts.subreddit,
      postAuthor: redditPosts.author,
      commentAuthor: redditComments.author,
      url: LEAD_URL,
      score: leads.score,
      stage: leads.stage,
      reason: leads.reason,
      matchedPhrase: leads.matchedPhrase,
      sellerSide: leads.sellerSide,
      status: leads.status,
      postedAt: sql<Date>`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`,
      scoredAt: leads.scoredAt,
      body: sql<string | null>`coalesce(${redditComments.body}, ${redditPosts.body})`,
    })
    .from(leads)
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .where(and(eq(leads.id, leadId), eq(projects.userId, userId)))) as (Row & {
    projectId: string;
  })[];
  const row = rows[0];
  if (!row) {
    return null;
  }
  const costs = await costsFor(row.projectId, [row]);
  return shape(row, row.postId ? (costs.get(row.postId) ?? null) : null, true);
}
