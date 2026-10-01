import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, projects, redditAuthors, redditComments, redditPosts } from "@/db/schema";

import type { PgSelectBase, SelectedFields } from "drizzle-orm/pg-core";

/**
 * The SQL every read of a Reddit lead shares. A lead is a thread or one
 * comment in it, so each fact about the need - when it was written, who wrote
 * it, what they said and where it is - is the comment's when the lead is one
 * and the post's otherwise. Each reads `reddit_posts` and a left-joined
 * `reddit_comments`. The feed, the API, the alerts, the competitor screen and
 * Insights all take them from here, so none of them can read a comment lead
 * as its thread.
 *
 * A fragment is one shared object: wrap it, sql`${NEED_AT}`.mapWith(...),
 * rather than calling mapWith on it, which would change it for every query.
 */

/** When the need was written. A comment lead is as old as the comment, never as old as the thread. */
export const NEED_AT = sql<Date>`coalesce(${redditComments.createdAt}, ${redditPosts.createdAt})`;

/** Who wrote the need: the comment's author when the lead is a comment. */
export const LEAD_AUTHOR = sql<string | null>`coalesce(${redditComments.author}, ${redditPosts.author})`;

/** The need in its author's words: the comment, or the post's body. */
export const LEAD_BODY = sql<string | null>`coalesce(${redditComments.body}, ${redditPosts.body})`;

/** Where the lead's own words are: the comment when it is one, else the post. */
export const LEAD_URL = sql<string>`coalesce(${redditComments.permalink}, ${redditPosts.url})`;

/** The join that puts the lead's author, and so their face, on a row: `reddit_authors` on LEAD_AUTHOR. */
export const LEAD_AUTHOR_JOIN = eq(redditAuthors.username, sql`lower(${LEAD_AUTHOR})`);

/** The tables leadsBase joins, and whether a row can come back without each. */
type LeadsBaseJoins = {
  leads: "not-null";
  reddit_posts: "not-null";
  reddit_comments: "nullable";
  projects: "not-null";
};

/** What leadsBase hands back: a select over `fields` with those joins made. */
type LeadsBase<T extends SelectedFields> = PgSelectBase<"leads", T, "partial", LeadsBaseJoins>;

/**
 * A whole lead, ready for its conditions: the lead, its thread, the comment it
 * may be, and the project whose score floor and word lists it is measured
 * against. A read that wants a face or a community joins those on after.
 *
 * drizzle cannot type a chain of joins over a selection it has not seen yet,
 * so the chain is built over any selection and handed back as the type the
 * same chain has over `fields`. tests/leadSql.test.ts holds the two equal.
 */
export function leadsBase<T extends SelectedFields>(fields: T): LeadsBase<T> {
  const selection: SelectedFields = fields;
  return db()
    .select(selection)
    .from(leads)
    .innerJoin(redditPosts, eq(redditPosts.id, leads.postId))
    .leftJoin(redditComments, eq(redditComments.id, leads.commentId))
    .innerJoin(projects, eq(projects.id, leads.projectId)) as unknown as LeadsBase<T>;
}
