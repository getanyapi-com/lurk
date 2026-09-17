import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Reddit and Google facts. Stored once for every tenant, keyed by the upstream
 * identity, so two projects tracking the same query pay for one fetch.
 */

export const redditPosts = pgTable(
  "reddit_posts",
  {
    id: text("id").primaryKey(),
    subreddit: text("subreddit").notNull(),
    author: text("author"),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url").notNull(),
    score: integer("score"),
    numComments: integer("num_comments"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the body and the comment thread were last really seen. `fetchedAt`
     * only says a listing mentioned this post, which a listing does without
     * carrying a body, so it cannot answer "when was this last verified".
     */
    bodyObservedAt: timestamp("body_observed_at", { withTimezone: true }),
    commentsObservedAt: timestamp("comments_observed_at", { withTimezone: true }),
    raw: jsonb("raw"),
  },
  (t) => [index("reddit_posts_subreddit_created_at_idx").on(t.subreddit, t.createdAt)],
);

/**
 * One product-agnostic reading of one post: who is speaking and whether they
 * are asking for anything. It says nothing about any product, so every project
 * watching this post reads the same row and only the first of them pays for it.
 * Kept beside the post rather than beside a verdict for that reason.
 */
export const postReadings = pgTable("post_readings", {
  postId: text("post_id")
    .primaryKey()
    .references(() => redditPosts.id, { onDelete: "cascade" }),
  /** Who is speaking: buyer, seller, helper, discussion or unknown. */
  relationship: text("relationship").notNull(),
  /** The state of their own need: open, evaluating, resolved, no_active_need or unknown. */
  needState: text("need_state").notNull(),
  /** The sentence of their own that states the need, or null when none does. */
  quote: text("quote"),
  /** The hash of the title and body this reading was made from. */
  contentHash: text("content_hash").notNull(),
  /** Bumped when the prompt changes what a stored reading means. */
  readingVersion: text("reading_version").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
});

export const redditComments = pgTable("reddit_comments", {
  id: text("id").primaryKey(),
  postId: text("post_id")
    .notNull()
    .references(() => redditPosts.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  author: text("author"),
  body: text("body"),
  score: integer("score"),
  /** The comment's own Reddit link, so a lead card opens on the comment. */
  permalink: text("permalink"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  raw: jsonb("raw"),
});

export const subreddits = pgTable("subreddits", {
  name: text("name").primaryKey(),
  iconUrl: text("icon_url"),
  subscribers: integer("subscribers"),
  rulesText: text("rules_text"),
  promoPolicy: text("promo_policy"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One Reddit account's public face, so a lead can show who is asking. */
export const redditAuthors = pgTable("reddit_authors", {
  username: text("username").primaryKey(),
  avatarUrl: text("avatar_url"),
  /** Total karma as Reddit reports it, so a card can say how established the account is. */
  karma: integer("karma"),
  /** When the account was opened, which reads differently from a karma count alone. */
  accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
  raw: jsonb("raw"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const searchRuns = pgTable(
  "search_runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    /** The AnyAPI endpoint this run was bought from, so two SKUs never share a run. */
    sku: text("sku").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    sort: text("sort"),
    timeframe: text("timeframe"),
    /**
     * The canonical string of every other effective parameter: the page cursor,
     * a listing limit, a geography. Two calls that differ only here are two
     * different answers, so they must not reuse each other's run. Empty means
     * the call took the endpoint's defaults.
     */
    variant: text("variant").notNull().default(""),
    /** The cursor this run's upstream handed back, or null at the end of a walk. */
    nextCursor: text("next_cursor"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    requestId: text("request_id"),
    fundedBy: text("funded_by").notNull(),
  },
  (t) => [index("search_runs_kind_query_fetched_at_idx").on(t.kind, t.normalizedQuery, t.fetchedAt)],
);

export const serpResults = pgTable("serp_results", {
  id: text("id").primaryKey(),
  searchRunId: text("search_run_id")
    .notNull()
    .references(() => searchRuns.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  url: text("url").notNull(),
  title: text("title"),
  snippet: text("snippet"),
});

/**
 * Which posts one run returned, so a reused run can hand back exactly the rows
 * it produced instead of guessing from the shared post table.
 */
export const searchRunPosts = pgTable(
  "search_run_posts",
  {
    searchRunId: text("search_run_id")
      .notNull()
      .references(() => searchRuns.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => redditPosts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.searchRunId, t.postId] })],
);
