import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { discoveryEvidence, redditPosts, seoOpportunities, subreddits } from "@/db/schema";
import type { Relevance } from "@/lib/discovery/label";

/**
 * What a refresh writes as its progress when the project has no problem
 * phrasings. The refresh writes it and the page reads it, so the sentence lives
 * here once rather than as the same string in two files.
 */
export const NO_PHRASINGS_PROGRESS = "No problem phrasings to look up yet";

/**
 * The order a ranking thread is worth replying in. Discovery already judges
 * every thread it buys against this product, and since both sides ask Google
 * the one question, the threads Google ranks for a phrasing are the threads
 * discovery labelled. A thread nobody has judged sits above one judged to hold
 * nobody asking, because an unread thread is not a rejected one.
 */
export const VERDICT_ORDER: Relevance[] = ["relevant", "plausible", "unlabeled", "irrelevant"];

/** The same order as a SQL CASE, so the database sorts on what this file says. */
function verdictRank() {
  const arms = VERDICT_ORDER.map(
    (verdict, index) => sql`when ${verdict} then ${index + 1}`,
  );
  return sql<number>`min(case ${discoveryEvidence.relevance} ${sql.join(arms, sql` `)} else ${VERDICT_ORDER.length} end)`;
}

/** What this project has already judged each thread to be, best verdict kept. */
function verdicts(projectId: string) {
  return db()
    .select({ postId: discoveryEvidence.postId, rank: verdictRank().as("rank") })
    .from(discoveryEvidence)
    .where(eq(discoveryEvidence.projectId, projectId))
    .groupBy(discoveryEvidence.postId)
    .as("verdicts");
}

export type SeoRow = Awaited<ReturnType<typeof listOpportunities>>[number];

export type SeoFilter = { keyword?: string; subreddit?: string; competitor?: string };

/** The verdict one rank stands for, or null when nothing has judged the thread. */
export function verdictOf(rank: number | null): Relevance | null {
  const verdict = rank === null ? null : VERDICT_ORDER[rank - 1];
  return verdict && verdict !== "unlabeled" ? verdict : null;
}

/** What one Google search cost this project, for the cost line on its threads. */

export type SeoFacets = { keywords: string[]; subreddits: string[] };

const columns = {
  id: seoOpportunities.id,
  keyword: seoOpportunities.keyword,
  position: seoOpportunities.position,
  competitorPresent: seoOpportunities.competitorPresent,
  refreshedAt: seoOpportunities.refreshedAt,
  postId: redditPosts.id,
  title: redditPosts.title,
  url: redditPosts.url,
  subreddit: redditPosts.subreddit,
  subredditIconUrl: subreddits.iconUrl,
  score: redditPosts.score,
  numComments: redditPosts.numComments,
  createdAt: redditPosts.createdAt,
};

/**
 * Every ranking thread this project holds, keyword by keyword, the ones worth
 * replying in first and Google's own rank breaking the tie. It sorts rather
 * than hides: a thread with nobody asking in it still ranks, and one reply in
 * it still works, which is what this tab is for.
 */
export async function listOpportunities(projectId: string, filter: SeoFilter) {
  const judged = verdicts(projectId);
  return db()
    .select({ ...columns, verdictRank: judged.rank })
    .from(seoOpportunities)
    .innerJoin(redditPosts, eq(redditPosts.id, seoOpportunities.postId))
    .leftJoin(subreddits, eq(subreddits.name, sql`lower(${redditPosts.subreddit})`))
    .leftJoin(judged, eq(judged.postId, seoOpportunities.postId))
    .where(
      and(
        eq(seoOpportunities.projectId, projectId),
        filter.keyword ? eq(seoOpportunities.keyword, filter.keyword) : undefined,
        filter.subreddit ? eq(sql`lower(${redditPosts.subreddit})`, filter.subreddit) : undefined,
        filter.competitor === "yes" ? eq(seoOpportunities.competitorPresent, true) : undefined,
        filter.competitor === "no" ? eq(seoOpportunities.competitorPresent, false) : undefined,
      ),
    )
    .orderBy(
      asc(seoOpportunities.keyword),
      sql`coalesce(${judged.rank}, ${VERDICT_ORDER.indexOf("unlabeled") + 1})`,
      asc(seoOpportunities.position),
    );
}

/**
 * How many ranking threads this project holds. The rail's pill shows the
 * number, so it asks for the number rather than for every thread, its verdict
 * and its community on every page of the app.
 */
export async function countOpportunities(projectId: string): Promise<number> {
  const rows = await db()
    .select({ total: count() })
    .from(seoOpportunities)
    // The same join the list makes, because a thread whose post has aged out
    // of our thirty days keeps its row with a null post and the list does not
    // show it. A count that included it would promise a thread that is gone.
    .innerJoin(redditPosts, eq(redditPosts.id, seoOpportunities.postId))
    .where(eq(seoOpportunities.projectId, projectId));
  return rows[0]?.total ?? 0;
}

/** The keywords and communities the filter pills can actually offer. */
export async function seoFacets(projectId: string): Promise<SeoFacets> {
  const rows = await db()
    .select({ keyword: seoOpportunities.keyword, subreddit: redditPosts.subreddit })
    .from(seoOpportunities)
    .innerJoin(redditPosts, eq(redditPosts.id, seoOpportunities.postId))
    .where(eq(seoOpportunities.projectId, projectId));
  return {
    keywords: [...new Set(rows.map((row) => row.keyword))].sort(),
    subreddits: [...new Set(rows.map((row) => row.subreddit))].sort(),
  };
}
