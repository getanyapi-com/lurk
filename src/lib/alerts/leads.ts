import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, redditAuthors, redditComments, redditPosts } from "@/db/schema";
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
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
}
