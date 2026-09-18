import { aliasedTable, and, asc, count, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  leadEvaluations,
  leads,
  painThemes,
  projects,
  redditAuthors,
  redditComments,
  redditPosts,
  searchRunPosts,
  subreddits,
  usageLedger,
} from "@/db/schema";
import { forgetProjectFeed } from "./projectFeedCache";
import { DEFAULT_SCORE_THRESHOLD } from "./scan/constants";
import { atBounds } from "./feed";

import type {
  FeedFacets,
  FeedFilter,
  FeedPage,
  FeedWindow,
  LeadCost,
  LeadFace,
  ReviewItem,
} from "./feed";

const postAuthors = aliasedTable(redditAuthors, "post_authors");

const feedColumns = {
  id: leads.id,
  score: leads.score,
  fit: leads.fit,
  intent: leads.intent,
  engagement: leads.engagement,
  stage: leads.stage,
  reason: leads.reason,
  matchedPhrase: leads.matchedPhrase,
  status: leads.status,
  kind: leads.kind,
  postId: leads.postId,
  title: redditPosts.title,
  subreddit: redditPosts.subreddit,
  postAuthor: redditPosts.author,
  postAuthorAvatar: postAuthors.avatarUrl,
  url: redditPosts.url,
  numComments: redditPosts.numComments,
  postScore: redditPosts.score,
  imageUrl: redditPosts.imageUrl,
  createdAt: redditPosts.createdAt,
  body: redditPosts.body,
  subredditIconUrl: subreddits.iconUrl,
  promoPolicy: subreddits.promoPolicy,
  rulesText: subreddits.rulesText,
  commentId: leads.commentId,
  commentPermalink: redditComments.permalink,
  bodyObservedAt: redditPosts.bodyObservedAt,
  commentsObservedAt: redditPosts.commentsObservedAt,
  commentBody: redditComments.body,
  commentAuthor: redditComments.author,
  commentScore: redditComments.score,
  commentCreatedAt: redditComments.createdAt,
  authorAvatar: redditAuthors.avatarUrl,
  authorKarma: redditAuthors.karma,
  authorCreatedAt: redditAuthors.accountCreatedAt,
  subredditWeeklyActive: subreddits.subscribers,
};

/** The author behind a lead, for the face a row and the strip both show. */
const AUTHOR_JOIN = eq(
  redditAuthors.username,
  sql`lower(coalesce(${redditComments.author}, ${redditPosts.author}))`,
);

/**
 * A whole lead: the thread, the comment it may be, the project whose score
 * floor it is measured against, its community and the two faces on it.
 */
function feedQuery() {
  return db()
    .select(feedColumns)
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .leftJoin(redditAuthors, AUTHOR_JOIN)
    .leftJoin(postAuthors, eq(postAuthors.username, sql`lower(${redditPosts.author})`));
}

/** One lead as every read of the feed hands it over. */
export type FeedLead = Awaited<ReturnType<typeof feedQuery>>[number];

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** A comment lead is as old as the comment, never as old as the thread. */
const NEED_AT = sql`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`;

/**
 * The window rule the whole Leads page reads, feed and header sentence alike:
 * a row belongs to a window by the need date, not by when we looked at it.
 * Postgres wants the bound date as text when the column is a plain expression.
 * The `all` window is no bound at all, so the backfill's older finds are shown.
 */
export function newerThan(days: FeedWindow) {
  if (days === "all") {
    return undefined;
  }
  return sql`${NEED_AT} >= ${since(days).toISOString()}::timestamptz`;
}

/**
 * One slice of that window - a month, a day, an hour - clicked in the people
 * strip. Read on the same need date the window is, so a column of faces and
 * the list under it hold exactly the same leads.
 */
export function onAt(at: string | undefined) {
  if (!at) {
    return undefined;
  }
  const { start, end } = atBounds(at);
  return sql`${NEED_AT} >= ${start.toISOString()}::timestamptz and ${NEED_AT} < ${end.toISOString()}::timestamptz`;
}

/**
 * The project's own minimum score, applied when the feed is read. Moving it on
 * the Product page changes the next page load, with no rescan and nothing
 * deleted, because the judgement and the user's floor are different facts. The
 * floor is a buyer-quality bar, so a `context` thread - kept for a comment, not
 * for its buyer intent - is never measured against it; its score is the
 * intent of someone who is not the buyer, and would always fall short.
 */
const OVER_THRESHOLD = sql`(${leads.kind} = 'context' OR ${leads.score} >= coalesce(${projects.scoreThreshold}, ${DEFAULT_SCORE_THRESHOLD}))`;

/**
 * The lead ids one Insights theme holds. The theme owns the list, so narrowing
 * the feed to a theme is a membership test against that row and not a rescore.
 * The row is found by id: a label is model-written prose that two runs can
 * collide on or reword, and the card links by id.
 */
function leadIdsOfTheme(projectId: string, themeId: string) {
  return sql<string>`(
    select unnest(coalesce(${painThemes.leadIds}, '{}'))
    from ${painThemes}
    where ${painThemes.projectId} = ${projectId} and ${painThemes.id} = ${themeId}
  )`;
}

/** One set of filter pills, as SQL. Read by every query on this page. */
function feedWhere(projectId: string, filter: FeedFilter) {
  return and(
    eq(leads.projectId, projectId),
    eq(leads.status, filter.status),
    OVER_THRESHOLD,
    newerThan(filter.days),
    onAt(filter.at),
    filter.kind ? eq(leads.kind, filter.kind) : undefined,
    filter.subreddit ? eq(sql`lower(${redditPosts.subreddit})`, filter.subreddit) : undefined,
    filter.stage ? eq(leads.stage, filter.stage) : undefined,
    filter.theme ? inArray(leads.id, leadIdsOfTheme(projectId, filter.theme)) : undefined,
  );
}

/**
 * The feed's order: best first, then the newer need, then the row's own id.
 * The id decides nothing a person can see; it is there because two leads can
 * hold the same score and the same minute, and a page boundary that falls
 * between them would otherwise show one of them twice and the other never.
 */
const FEED_ORDER = [desc(leads.score), desc(NEED_AT), asc(leads.id)];

/**
 * The feed, best first, for one set of filter pills. A page is a slice of that
 * order; without one the whole feed is read, which is what the alerts digest
 * and the API want and what the page itself no longer asks for.
 */
export async function listLeads(
  projectId: string,
  filter: FeedFilter,
  page?: FeedPage,
): Promise<FeedLead[]> {
  const query = feedQuery()
    .where(feedWhere(projectId, filter))
    .orderBy(...FEED_ORDER);
  return page ? query.limit(page.limit).offset(page.offset) : query;
}

/** How many leads those pills hold, which is what the list column counts. */
export async function countLeads(projectId: string, filter: FeedFilter): Promise<number> {
  const rows = await db()
    .select({ total: count() })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .where(feedWhere(projectId, filter));
  return rows[0]?.total ?? 0;
}

/**
 * Every person the window holds, for the strip of faces over the feed. The
 * strip is a calendar of who asked and when, so it stays whole while the list
 * under it is read a page at a time; this reads the six columns a face needs
 * and none of the prose a row does.
 */
export async function listLeadFaces(projectId: string, filter: FeedFilter): Promise<LeadFace[]> {
  return db()
    .select({
      id: sql<string>`'lead-' || ${leads.id}`,
      at: sql`${NEED_AT}`.mapWith(redditPosts.createdAt),
      score: leads.score,
      author: sql<string | null>`coalesce(${redditComments.author}, ${redditPosts.author})`,
      avatarUrl: redditAuthors.avatarUrl,
      subreddit: redditPosts.subreddit,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(redditAuthors, AUTHOR_JOIN)
    .where(feedWhere(projectId, filter))
    .orderBy(...FEED_ORDER);
}

/**
 * One lead by its own id, whatever page of the feed it sits on. Clicking the
 * fortieth row asks the server for a thread the first page never held, and the
 * pane has to open on it rather than falling back to the best lead.
 */
export async function findLead(projectId: string, leadId: string): Promise<FeedLead | undefined> {
  const rows = await feedQuery().where(
    and(eq(leads.projectId, projectId), eq(leads.id, leadId)),
  );
  return rows[0];
}

/**
 * The candidates the scan held back because the evidence did not settle them.
 * They are not leads and never enter the feed count, but they are the seven or
 * so items per scan that a person can settle in a glance. A thread that is
 * already a lead for this project is never listed twice: a later rerun holding
 * it does not undo the earlier call.
 */
export async function listReviewItems(
  projectId: string,
  days: FeedWindow,
  at?: string,
): Promise<ReviewItem[]> {
  const rows = await db()
    .select({
      id: leadEvaluations.id,
      title: redditPosts.title,
      subreddit: redditPosts.subreddit,
      url: sql<string>`coalesce(${redditComments.permalink}, ${redditPosts.url})`,
      author: sql<string | null>`coalesce(${redditComments.author}, ${redditPosts.author})`,
      avatarUrl: redditAuthors.avatarUrl,
      authorKarma: redditAuthors.karma,
      authorCreatedAt: redditAuthors.accountCreatedAt,
      subredditIconUrl: subreddits.iconUrl,
      numComments: redditPosts.numComments,
      points: sql<number | null>`coalesce(${redditComments.score}, ${redditPosts.score})`,
      isComment: sql<boolean>`${leadEvaluations.commentId} is not null`,
      reason: leadEvaluations.reason,
      reasonCodes: leadEvaluations.reasonCodes,
      fit: leadEvaluations.fit,
      intent: leadEvaluations.intent,
      needState: leadEvaluations.needState,
      createdAt: sql`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`.mapWith(redditPosts.createdAt),
      judgedAt: leadEvaluations.judgedAt,
    })
    .from(leadEvaluations)
    .innerJoin(redditPosts, eq(redditPosts.id, leadEvaluations.postId))
    .leftJoin(redditComments, eq(redditComments.id, leadEvaluations.commentId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .leftJoin(
      redditAuthors,
      eq(redditAuthors.username, sql`lower(coalesce(${redditComments.author}, ${redditPosts.author}))`),
    )
    .where(
      and(
        eq(leadEvaluations.projectId, projectId),
        eq(leadEvaluations.decision, "review"),
        newerThan(days),
        onAt(at),
        notExists(
          db()
            .select({ one: sql`1` })
            .from(leads)
            .where(
              and(
                eq(leads.projectId, leadEvaluations.projectId),
                eq(leads.postId, leadEvaluations.postId),
                sql`${leads.commentId} is not distinct from ${leadEvaluations.commentId}`,
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(leadEvaluations.judgedAt));
  return rows;
}

/** The subreddits and stages this project actually has leads in. */
export async function feedFacets(projectId: string): Promise<FeedFacets> {
  const rows = await db()
    .select({ subreddit: redditPosts.subreddit, stage: leads.stage })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .where(eq(leads.projectId, projectId));
  return {
    subreddits: [...new Set(rows.map((row) => row.subreddit))].sort(),
    stages: [...new Set(rows.map((row) => row.stage).filter((stage): stage is string => !!stage))],
  };
}

export async function newLeadCount(projectId: string): Promise<number> {
  const rows = await db()
    .select({ total: count() })
    .from(leads)
    .where(and(eq(leads.projectId, projectId), eq(leads.status, "new")));
  return rows[0]?.total ?? 0;
}

/**
 * What this project paid to have each post in front of it: the first ledger
 * line against a run that produced the post, preferring the paid fetch over the
 * reuse that followed it.
 */
export async function leadCosts(
  projectId: string,
  postIds: string[],
): Promise<Map<string, LeadCost>> {
  if (postIds.length === 0) {
    return new Map();
  }
  const rows = await db()
    .select({
      postId: searchRunPosts.postId,
      sku: usageLedger.sku,
      costUsd: usageLedger.costUsd,
      requestId: usageLedger.requestId,
      reused: usageLedger.reused,
      at: usageLedger.at,
    })
    .from(usageLedger)
    .innerJoin(searchRunPosts, eq(searchRunPosts.searchRunId, usageLedger.searchRunId))
    .where(and(eq(usageLedger.projectId, projectId), inArray(searchRunPosts.postId, postIds)))
    .orderBy(asc(usageLedger.reused), asc(usageLedger.at));
  const byPost = new Map<string, LeadCost>();
  for (const row of rows) {
    if (!byPost.has(row.postId)) {
      byPost.set(row.postId, {
        sku: row.sku,
        costUsd: Number(row.costUsd),
        requestId: row.requestId,
      });
    }
  }
  return byPost;
}

/** Whether this project holds a lead in the named community. */
export async function leadInSubreddit(projectId: string, subreddit: string): Promise<boolean> {
  const rows = await db()
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(sql`lower(${redditPosts.subreddit})`, subreddit.trim().toLowerCase()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Moves a lead out of the feed, recording why when the user says it is a miss. */
export async function setLeadStatus(
  projectId: string,
  leadId: string,
  status: FeedFilter["status"],
  notFitReason: string | null,
): Promise<void> {
  await db()
    .update(leads)
    .set({ status, notFitReason })
    .where(and(eq(leads.id, leadId), eq(leads.projectId, projectId)));
  forgetProjectFeed(projectId);
}
