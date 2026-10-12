import { randomUUID } from "node:crypto";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { searchRuns } from "./shared";
import { projects } from "./tenant";

/**
 * The X leads module's tables, kept apart from Reddit's on purpose: every
 * Reddit lead table has a foreign key to reddit_posts, and X is a separate tab
 * that must never show up in, or be counted by, a Reddit reader. See
 * src/lib/x/ for the pipeline that writes them.
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

/**
 * One X post, stored once for every tenant, keyed by its id. Ids are snowflakes
 * above 2^53, so they stay text: a JS number would corrupt them. The URL is
 * never a key, because the lane that served a call decides which of two URL
 * forms comes back.
 */
export const xPosts = pgTable(
  "x_posts",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    lang: text("lang"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    authorUsername: text("author_username").notNull(),
    authorName: text("author_name"),
    authorId: text("author_id"),
    authorImage: text("author_image"),
    authorFollowers: integer("author_followers"),
    authorVerified: boolean("author_verified"),
    isReply: boolean("is_reply").notNull().default(false),
    /** No foreign key: the parent is often a post nobody bought. */
    inReplyToId: text("in_reply_to_id"),
    conversationId: text("conversation_id"),
    likeCount: integer("like_count"),
    replyCount: integer("reply_count"),
    retweetCount: integer("retweet_count"),
    quoteCount: integer("quote_count"),
    viewCount: integer("view_count"),
    bookmarkCount: integer("bookmark_count"),
    mediaCount: integer("media_count"),
    /** Set when a later lookup came back not found: deleted, protected or withheld. */
    unavailableAt: timestamp("unavailable_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("x_posts_created_at_idx").on(t.createdAt),
    index("x_posts_conversation_idx").on(t.conversationId),
    index("x_posts_fetched_at_idx").on(t.fetchedAt),
  ],
);

/** What twitter.profile said about an author, bought only for posts past the first judgement. */
export const xAuthors = pgTable(
  "x_authors",
  {
    /** Lowercase handle, which is what twitter.profile is asked by. */
    username: text("username").primaryKey(),
    authorId: text("author_id"),
    name: text("name"),
    bio: text("bio"),
    followers: integer("followers"),
    following: integer("following"),
    accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
    verified: boolean("verified"),
    private: boolean("private"),
    website: text("website"),
    location: text("location"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("x_authors_fetched_at_idx").on(t.fetchedAt)],
);

/** Which posts one X search run returned, in order, so a reused run hands back exactly those. */
export const xSearchRunPosts = pgTable(
  "x_search_run_posts",
  {
    searchRunId: text("search_run_id")
      .notNull()
      .references(() => searchRuns.id, { onDelete: "cascade" }),
    tweetId: text("tweet_id")
      .notNull()
      .references(() => xPosts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.searchRunId, t.tweetId] }),
    // Retention deletes x_posts, and each deleted post's cascade looks here by tweet.
    index("x_search_run_posts_tweet_idx").on(t.tweetId),
  ],
);

/** One row per project that has opened its X tab: the switches and clocks X keeps per project. */
export const xProjects = pgTable("x_projects", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
  /** A scan stops booking its successor once nobody has opened the tab for a week. */
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  /**
   * Whether the project's alert channels carry its X asks (Settings, X). Off,
   * a channel neither sends X asks nor keeps the scan alive unopened.
   */
  alerts: boolean("alerts").notNull().default(true),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  /** What the lanes were compiled from; a change recompiles them at the next scan. */
  lanesInputHash: text("lanes_input_hash"),
  /** The search words the model wrote for this project, and the inputs they were written from (src/lib/x/seeds.ts). */
  seeds: jsonb("seeds"),
});

/**
 * One X search this project runs. X matches words exactly and has no venue, so
 * the query is the venue: a lane is one to three AND groups of alternatives,
 * `terms`, compiled to `body` (src/lib/x/lanes.ts). A rival lane binds rival
 * names to switch words; a diy lane binds the category to the words someone
 * building their own writes; a stack lane binds the job's words to the tools
 * people build in, with a like floor. `body` is exact case with no
 * since_time, which is added at call time from the watermark.
 */
export const xLanes = pgTable(
  "x_lanes",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** rival, request, diy (build-vs-buy) or stack (workflow); see src/lib/x/lanes.ts. */
    family: text("family").notNull(),
    /** The rivals a lane covers; empty for a stack lane. */
    seeds: text("seeds").array().notNull(),
    /** The AND groups of OR alternatives the body was compiled from, which the screen checks a post shows. */
    terms: jsonb("terms").$type<string[][]>().notNull().default([]),
    /** What the lane looks for, in words the tab shows. */
    label: text("label"),
    /** Its place in the project's lanes: the tier's lane count takes the lowest active ranks. */
    rank: integer("rank").notNull().default(0),
    body: text("body").notNull(),
    /** active, paused, retired or refused. */
    state: text("state").notNull().default("active"),
    pauseReason: text("pause_reason"),
    lastError: text("last_error"),
    /** Posts up to here have been seen. An empty page never moves it. */
    coveredUntil: timestamp("covered_until", { withTimezone: true }),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }),
    emptyStreak: integer("empty_streak").notNull().default(0),
    runs: integer("runs").notNull().default(0),
    pages: integer("pages").notNull().default(0),
    emptyPages: integer("empty_pages").notNull().default(0),
    fullPages: integer("full_pages").notNull().default(0),
    posts: integer("posts").notNull().default(0),
    newPosts: integer("new_posts").notNull().default(0),
    screenedOut: integer("screened_out").notNull().default(0),
    judged: integer("judged").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    reviews: integer("reviews").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastLeadAt: timestamp("last_lead_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("x_lanes_project_body_idx").on(t.projectId, t.body),
    index("x_lanes_project_state_due_idx").on(t.projectId, t.state, t.nextDueAt),
  ],
);

/**
 * Every X post this project has seen, whatever became of it, so nothing is
 * screened or judged twice. `signals` keeps every raw answer the judge gave, so
 * the gates can be replayed at no cost and an X model fitted later.
 */
export const xEvaluations = pgTable(
  "x_evaluations",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tweetId: text("tweet_id")
      .notNull()
      .references(() => xPosts.id, { onDelete: "cascade" }),
    laneId: text("lane_id").references(() => xLanes.id, { onDelete: "set null" }),
    /** The lane phrase found in the post's own words, when one is. */
    matchedPhrase: text("matched_phrase"),
    /**
     * free_rejected, pending_parent, pending_llm, pending_context,
     * pending_reply, rejected, review, lead, reply, merged or expired.
     */
    stage: text("stage").notNull(),
    freeReject: text("free_reject"),
    /** search (judged on the post alone) or complete (with the author's bio). */
    level: text("level"),
    decision: text("decision"),
    reasonCode: text("reason_code"),
    reason: text("reason"),
    signals: jsonb("signals"),
    fit: integer("fit"),
    intent: integer("intent"),
    engagement: integer("engagement"),
    score: integer("score"),
    needQuote: text("need_quote"),
    /** The parents and bio the verdict was made with, kept so parents can age out. */
    context: jsonb("context"),
    llmAttempts: integer("llm_attempts").notNull().default(0),
    scorerVersion: text("scorer_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("x_evaluations_project_tweet_idx").on(t.projectId, t.tweetId),
    index("x_evaluations_project_stage_idx").on(t.projectId, t.stage),
    index("x_evaluations_project_created_at_idx").on(t.projectId, t.createdAt),
    index("x_evaluations_tweet_idx").on(t.tweetId),
    // Retention deletes retired lanes, and each one's SET NULL looks here by lane.
    index("x_evaluations_lane_idx").on(t.laneId),
  ],
);

/**
 * What the X tab shows. It mirrors `leads` (found_at, status, score), so an
 * alert or API reader added later is additive. `kind` is `ask`, someone asking
 * for what the product does, or `reply`, a post worth answering where nobody
 * is shopping yet. Any alert, email or API reader added later reads asks only
 * unless it says otherwise, as Reddit's alerts never sent the context kind.
 */
export const xLeads = pgTable(
  "x_leads",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tweetId: text("tweet_id")
      .notNull()
      .references(() => xPosts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("ask"),
    /** For a reply, what kind of place it is: has_the_problem, workflow, building_their_own, price_gripe or open_question. */
    moment: text("moment"),
    score: integer("score").notNull(),
    fit: integer("fit"),
    intent: integer("intent"),
    engagement: integer("engagement"),
    reason: text("reason"),
    /** The verbatim sentence the verdict rests on. */
    matchedPhrase: text("matched_phrase"),
    authorUsername: text("author_username").notNull(),
    conversationId: text("conversation_id"),
    status: text("status").notNull().default("new"),
    notFitReason: text("not_fit_reason"),
    /** When the project first held this lead. A re-judge moves scoredAt and never this. */
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("x_leads_project_tweet_idx").on(t.projectId, t.tweetId),
    index("x_leads_project_found_at_idx").on(t.projectId, t.foundAt),
    index("x_leads_project_score_idx").on(t.projectId, t.score.desc()),
    index("x_leads_project_conversation_idx").on(t.projectId, t.conversationId),
    index("x_leads_tweet_idx").on(t.tweetId),
  ],
);

/** One X scan: its funnel and what it cost, so the tab can say what happened. */
export const xRuns = pgTable(
  "x_runs",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobId: text("job_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    firstLeadAt: timestamp("first_lead_at", { withTimezone: true }),
    lanesRun: integer("lanes_run").notNull().default(0),
    pages: integer("pages").notNull().default(0),
    emptyPages: integer("empty_pages").notNull().default(0),
    fullPages: integer("full_pages").notNull().default(0),
    postsFetched: integer("posts_fetched").notNull().default(0),
    postsNew: integer("posts_new").notNull().default(0),
    screenedOut: jsonb("screened_out").notNull().default({}),
    parents: integer("parents").notNull().default(0),
    judged: integer("judged").notNull().default(0),
    profiles: integer("profiles").notNull().default(0),
    finals: integer("finals").notNull().default(0),
    replyChecks: integer("reply_checks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    reviews: integer("reviews").notNull().default(0),
    dataUsd: numeric("data_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    llmUsd: numeric("llm_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    partialReason: text("partial_reason"),
  },
  (t) => [index("x_runs_project_started_at_idx").on(t.projectId, t.startedAt)],
);
