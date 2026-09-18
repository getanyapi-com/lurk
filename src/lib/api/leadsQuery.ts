import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditComments, redditPosts } from "@/db/schema";
import type { LeadStatus } from "@/lib/feed";
import { ApiError } from "./responses";

export type LeadStatusFilter = LeadStatus | "all";

const STATUSES: LeadStatusFilter[] = ["new", "hidden", "not_fit", "resolved", "all"];

/** Page size, and the cap the reference products in this category publish. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export type LeadQuery = {
  status: LeadStatusFilter;
  minScore: number | null;
  since: Date | null;
  limit: number;
  offset: number;
  includeBody: boolean;
};

function integerParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw === "") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ApiError("invalid_request", `${name} must be a whole number.`);
  }
  return value;
}

/** Query string to filter, refusing anything it cannot read exactly. */
export function parseLeadQuery(params: URLSearchParams): LeadQuery {
  const status = (params.get("status") ?? "new") as LeadStatusFilter;
  if (!STATUSES.includes(status)) {
    throw new ApiError("invalid_request", `status must be one of ${STATUSES.join(", ")}.`);
  }
  const minScore = integerParam(params, "minScore");
  if (minScore !== null && (minScore < 0 || minScore > 100)) {
    throw new ApiError("invalid_request", "minScore must be between 0 and 100.");
  }
  const rawSince = params.get("since");
  const since = rawSince ? new Date(rawSince) : null;
  if (since && Number.isNaN(since.getTime())) {
    throw new ApiError("invalid_request", "since must be an ISO 8601 date or date-time.");
  }
  const limit = integerParam(params, "limit") ?? DEFAULT_LIMIT;
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ApiError("invalid_request", `limit must be between 1 and ${MAX_LIMIT}.`);
  }
  const offset = integerParam(params, "offset") ?? 0;
  if (offset < 0) {
    throw new ApiError("invalid_request", "offset must not be negative.");
  }
  return { status, minScore, since, limit, offset, includeBody: params.get("include") === "body" };
}

/** When the need was written. A comment lead is as old as its comment. */
const NEED_AT = sql<Date>`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`;

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * The conditions behind a leads call: the project, the feed window on when the
 * need was written (the comment's date for a comment lead, as the app's feed
 * reads it), and the caller's own filters. `since` is a different
 * question from the window - it asks when the lead appeared, which is what an
 * agent syncing incrementally wants.
 */
export function leadConditions(
  projectId: string,
  query: LeadQuery,
  feedWindowDays: number,
): SQL | undefined {
  return and(
    eq(leads.projectId, projectId),
    query.status === "all" ? undefined : eq(leads.status, query.status),
    sql`${NEED_AT} >= ${windowStart(feedWindowDays).toISOString()}::timestamptz`,
    query.minScore === null ? undefined : gte(leads.score, query.minScore),
    query.since ? gte(leads.scoredAt, query.since) : undefined,
  );
}

/** Where the lead's own words are: the comment when it is one, else the post. */
export const LEAD_URL = sql<string>`coalesce(${redditComments.permalink}, ${redditPosts.url})`;

const columns = {
  id: leads.id,
  postId: leads.postId,
  commentId: leads.commentId,
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
  postedAt: NEED_AT,
  scoredAt: leads.scoredAt,
  body: sql<string | null>`coalesce(${redditComments.body}, ${redditPosts.body})`,
};

/** One extra row is read so `hasMore` is a fact rather than a guess. */
export function leadsSelect(projectId: string, query: LeadQuery, feedWindowDays: number) {
  return db()
    .select(columns)
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .where(leadConditions(projectId, query, feedWindowDays))
    .orderBy(desc(leads.score), desc(NEED_AT))
    .limit(query.limit + 1)
    .offset(query.offset);
}
