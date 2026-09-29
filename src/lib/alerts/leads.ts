import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditAuthors, redditComments, redditPosts, xLeads, xPosts, xProjects } from "@/db/schema";
import { canonicalUrl, ownWords } from "@/lib/x/map";
import { headlineOf } from "@/lib/x/read";
import type { SelectableLead } from "./select";

/**
 * Leads a project first found since a moment, with the author's face attached. The
 * ordering and the cap are `selectLeads`, so the same rules cover a live send
 * and a test.
 */
export async function newLeadsSince(projectId: string, since: Date): Promise<SelectableLead[]> {
  const rows = await db()
    .select({
      id: leads.id,
      postId: redditPosts.id,
      score: leads.score,
      reason: leads.reason,
      matchedPhrase: leads.matchedPhrase,
      status: leads.status,
      kind: leads.kind,
      foundAt: leads.foundAt,
      title: redditPosts.title,
      body: sql<string | null>`coalesce(${redditComments.body}, ${redditPosts.body})`,
      isComment: sql<boolean>`${leads.commentId} is not null`,
      numComments: redditPosts.numComments,
      url: sql<string>`coalesce(${redditComments.permalink}, ${redditPosts.url})`,
      subreddit: redditPosts.subreddit,
      author: sql<string | null>`coalesce(${redditComments.author}, ${redditPosts.author})`,
      avatarUrl: redditAuthors.avatarUrl,
      createdAt: sql<Date>`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`,
    })
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .leftJoin(
      redditAuthors,
      eq(
        redditAuthors.username,
        sql`lower(coalesce(${redditComments.author}, ${redditPosts.author}))`,
      ),
    )
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(leads.status, "new"),
        gte(leads.foundAt, since),
      ),
    );
  return rows.map((row) => ({
    ...row,
    platform: "reddit" as const,
    createdAt: new Date(row.createdAt),
  }));
}

/**
 * One X ask as the digest reads it: headed the way the X tab heads it, quoting
 * the post's own words, grouped by its conversation. The face is the one the
 * post was fetched with; x_authors holds no picture.
 */
export function xAskLead(
  lead: typeof xLeads.$inferSelect,
  post: typeof xPosts.$inferSelect,
): SelectableLead {
  return {
    id: lead.id,
    platform: "x",
    postId: lead.conversationId ?? post.conversationId ?? post.id,
    title: headlineOf(post.text, post.isReply, lead.matchedPhrase),
    url: canonicalUrl(post.authorUsername, post.id),
    subreddit: null,
    author: post.authorUsername,
    avatarUrl: post.authorImage,
    score: lead.score,
    reason: lead.reason,
    matchedPhrase: lead.matchedPhrase,
    body: ownWords(post),
    isComment: false,
    numComments: post.replyCount,
    createdAt: post.createdAt,
    status: lead.status,
    // `alertable` sends buyers only, and an ask is X's buyer.
    kind: "buyer",
    foundAt: lead.foundAt,
  };
}

/**
 * The X asks a project first found since a moment. Replies are never alerted:
 * they are worth answering for about five hours, which a digest cannot keep.
 * A post X no longer shows is left out, as the tab leaves it out.
 */
export async function newXLeadsSince(projectId: string, since: Date): Promise<SelectableLead[]> {
  const rows = await db()
    .select({ lead: xLeads, post: xPosts })
    .from(xLeads)
    .innerJoin(xPosts, eq(xPosts.id, xLeads.tweetId))
    // The owner can keep X asks out of the project's channels (Settings, X).
    .leftJoin(xProjects, eq(xProjects.projectId, xLeads.projectId))
    .where(
      and(
        eq(xLeads.projectId, projectId),
        eq(xLeads.kind, "ask"),
        eq(xLeads.status, "new"),
        or(isNull(xProjects.alerts), eq(xProjects.alerts, true)),
        gte(xLeads.foundAt, since),
        isNull(xPosts.unavailableAt),
      ),
    );
  return rows.map(({ lead, post }) => xAskLead(lead, post));
}
