import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { redditComments, redditPosts, searchRuns } from "./shared";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** Per-tenant judgement. Everything here belongs to one user or one project. */

export const users = pgTable("users", {
  id: id(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  /**
   * What this user changed about their scan settings, and only that: the
   * preset owns every value they have not touched. `lib/settings` is the one
   * reader and the one writer.
   */
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletConnections = pgTable("wallet_connections", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  capUsd: numeric("cap_usd", { precision: 12, scale: 6 }),
  capPeriod: text("cap_period"),
  /**
   * When the owner was last emailed that the wallet is empty, or that the
   * connection was revoked. A failing job asks every hour; the person is told
   * once, and again only if it is still so days later or after a reconnect.
   */
  balanceNoticeAt: timestamp("balance_notice_at", { withTimezone: true }),
  reconnectNoticeAt: timestamp("reconnect_notice_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url"),
  pain: text("pain"),
  solution: text("solution"),
  targetUsers: text("target_users"),
  geography: text("geography"),
  budgetFit: text("budget_fit"),
  scoreThreshold: integer("score_threshold"),
  /**
   * Bumped on every edit to the facts a judgement is made against. A stored
   * evaluation is only reusable for the version it was made under, so editing
   * the product makes the next scan judge everything again.
   */
  profileVersion: integer("profile_version").notNull().default(1),
  /**
   * Bumped every time discovery republishes the retrieval plan. Separate from
   * `profileVersion` because learning where buyers ask changes no judgement,
   * so a new plan must not throw away verdicts the old plan's candidates got.
   */
  discoveryVersion: integer("discovery_version").notNull().default(1),
  /** What the product can actually do, one short phrase each. */
  capabilities: jsonb("capabilities"),
  /** What it cannot do, does not cover, or refuses, one short phrase each. */
  exclusions: jsonb("exclusions"),
  /** Who is explicitly not a buyer, one short phrase each. */
  notBuyers: jsonb("not_buyers"),
  /** Places this product serves, each with the page text it was read from. */
  destinations: jsonb("destinations"),
  /** How buyers say the problem, in their words, taken from the product page. */
  problemPhrasings: jsonb("problem_phrasings"),
  tierSnapshot: text("tier_snapshot"),
  /**
   * When the first discovery finished and the project's own jobs were queued.
   * Null means the project has been read but not yet set up, so the initial
   * discovery still owes it a plan. It is written in the same transaction as
   * those first jobs, so a crash between the two can never leave a project
   * that looks finished and has nothing queued.
   */
  discoveredAt: timestamp("discovered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What every row of the retrieval plan carries: where it came from (llm, serp,
 * user), whether it is being retrieved (active, pinned, excluded, candidate),
 * how much discovery evidence stands behind it, when its window was last
 * covered, and what it has actually produced since. A model guess and a
 * measured community are the same shape, so ranking can compare them.
 */
const planColumns = () => ({
  source: text("source").notNull().default("llm"),
  state: text("state").notNull().default("active"),
  evidence: integer("evidence").notNull().default(0),
  lastCoveredAt: timestamp("last_covered_at", { withTimezone: true }),
  freshCandidates: integer("fresh_candidates").notNull().default(0),
  freshLeads: integer("fresh_leads").notNull().default(0),
});

export const projectKeywords = pgTable(
  "project_keywords",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    ...planColumns(),
  },
  (t) => [uniqueIndex("project_keywords_project_keyword_idx").on(t.projectId, t.keyword)],
);

export const projectSubreddits = pgTable(
  "project_subreddits",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...planColumns(),
  },
  (t) => [uniqueIndex("project_subreddits_project_name_idx").on(t.projectId, t.name)],
);

export const projectCompetitors = pgTable(
  "project_competitors",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The site this company sells from, which is where its logo comes from.
     * Null when nothing we read told us, and then the name wears its initials
     * rather than a favicon guessed off the spelling.
     */
    domain: text("domain"),
    /** What this company is to us: direct substitute, alternative, supplier, reference. */
    role: text("role"),
    ...planColumns(),
  },
  (t) => [uniqueIndex("project_competitors_project_name_idx").on(t.projectId, t.name)],
);

/**
 * One Google result that told us where and how this project's buyers ask. The
 * plan is derived from these rows, so a community or a phrase can always be
 * traced back to the thread that argued for it. The post id is Reddit's, not a
 * reddit_posts row: evidence is recorded before any thread is bought.
 */
export const discoveryEvidence = pgTable(
  "discovery_evidence",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    subreddit: text("subreddit").notNull(),
    query: text("query").notNull(),
    family: text("family"),
    destination: text("destination"),
    position: integer("position"),
    title: text("title"),
    snippet: text("snippet"),
    relevance: text("relevance").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("discovery_evidence_project_post_query_idx").on(t.projectId, t.postId, t.query),
    index("discovery_evidence_project_subreddit_idx").on(t.projectId, t.subreddit),
  ],
);

/**
 * Where a candidate came from, one row per way we found it. The same post can
 * arrive from a keyword search, a scoped search, a listing and Google, and the
 * per-source counters are only honest if every one of those is recorded.
 */
export const candidateSources = pgTable(
  "candidate_sources",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => redditPosts.id, { onDelete: "cascade" }),
    /** search, scoped, listing or serp. */
    sourceKind: text("source_kind").notNull(),
    /** The query, community or keyword that produced it. */
    sourceKey: text("source_key").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candidate_sources_project_post_source_idx").on(
      t.projectId,
      t.postId,
      t.sourceKind,
      t.sourceKey,
    ),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => redditPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => redditComments.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    fit: integer("fit"),
    intent: integer("intent"),
    engagement: integer("engagement"),
    stage: text("stage"),
    reason: text("reason"),
    matchedPhrase: text("matched_phrase"),
    /**
     * What this lead is for: `buyer` is someone asking for what the product
     * does, `context` is a thread where nobody asks but a comment belongs.
     */
    kind: text("kind").notNull().default("buyer"),
    sellerSide: boolean("seller_side").notNull().default(false),
    status: text("status").notNull().default("new"),
    notFitReason: text("not_fit_reason"),
    /**
     * The reply count this project last read the post's thread at. The shared
     * `reddit_posts.comments_read_count` says when the thread was last bought;
     * this says when this project last judged it, which one project's purchase
     * must never settle for another.
     */
    threadReadCount: integer("thread_read_count"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the project first held this lead. A rescore moves `scoredAt` and
     * never this, so an alert window on it carries each lead exactly once.
     */
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_project_score_idx").on(t.projectId, t.score.desc()),
    index("leads_project_kind_idx").on(t.projectId, t.kind),
    uniqueIndex("leads_project_post_idx")
      .on(t.projectId, t.postId)
      .where(sql`${t.commentId} is null`),
    uniqueIndex("leads_project_comment_idx")
      .on(t.projectId, t.commentId)
      .where(sql`${t.commentId} is not null`),
  ],
);

/**
 * Every candidate this project has judged, whatever the verdict. The leads
 * table holds only what qualified, so without this a rejection was forgotten
 * and bought again on the next scan, and a review was invisible.
 */
export const leadEvaluations = pgTable(
  "lead_evaluations",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => redditPosts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => redditComments.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    relationship: text("relationship").notNull(),
    needState: text("need_state").notNull(),
    fit: integer("fit"),
    intent: integer("intent"),
    engagement: integer("engagement").notNull(),
    score: integer("score").notNull(),
    reasonCodes: text("reason_codes").array().notNull(),
    requirements: jsonb("requirements").notNull(),
    answerCoverage: text("answer_coverage").notNull(),
    evidenceQuote: text("evidence_quote"),
    reason: text("reason").notNull(),
    /** The project profile version and the text hash this verdict was made on. */
    profileVersion: integer("profile_version").notNull(),
    contentHash: text("content_hash").notNull(),
    scorerVersion: text("scorer_version").notNull(),
    judgedAt: timestamp("judged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_evaluations_project_post_idx")
      .on(t.projectId, t.postId)
      .where(sql`${t.commentId} is null`),
    uniqueIndex("lead_evaluations_project_comment_idx")
      .on(t.projectId, t.commentId)
      .where(sql`${t.commentId} is not null`),
    index("lead_evaluations_project_decision_idx").on(t.projectId, t.decision),
  ],
);

export const seoOpportunities = pgTable("seo_opportunities", {
  id: id(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  postId: text("post_id").references(() => redditPosts.id, { onDelete: "set null" }),
  position: integer("position"),
  competitorPresent: boolean("competitor_present").notNull().default(false),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const painThemes = pgTable("pain_themes", {
  id: id(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  summary: text("summary"),
  leadIds: text("lead_ids").array(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: id(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  target: text("target").notNull(),
  /** How the list names the target when the address itself is a secret, as a Slack webhook is. */
  label: text("label"),
  cadence: text("cadence").notNull(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
});

export const apiKeys = pgTable("api_keys", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hash: text("hash").notNull().unique(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  scopes: text("scopes").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    requestId: text("request_id"),
    searchRunId: text("search_run_id").references(() => searchRuns.id, { onDelete: "set null" }),
    /** Who paid, so a call with no shared run still counts against the cap. */
    fundedBy: text("funded_by").notNull().default("house"),
    reused: boolean("reused").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_ledger_project_at_idx").on(t.projectId, t.at)],
);

/**
 * Every language model call this instance made: what it cost, how long it took,
 * who served it, and whether it answered. The daily cap reads the cost, and the
 * scorer report reads the rest, so a question about a bad verdict is answered
 * from a table instead of by running the scan again.
 *
 * The columns after `cost_usd` are null on a row written before 2026-09-13,
 * because those calls really did record nothing else. `schema_failed` is the
 * exception: a failed call used to write no row at all, so false is exactly
 * right for every old one.
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    /** The model asked for, and the upstream OpenRouter routed the call to. */
    model: text("model"),
    provider: text("provider"),
    /** Wall time of the whole call, the retries inside the SDK included. */
    latencyMs: integer("latency_ms"),
    /** How many items a batched call asked for, and how many came back. */
    itemsAsked: integer("items_asked"),
    itemsAnswered: integer("items_answered"),
    finishReason: text("finish_reason"),
    /** True when the answer could not be read as the shape that was asked for. */
    schemaFailed: boolean("schema_failed").notNull().default(false),
    /** 1 for the first call, 2 for the one that asks again for skipped ids. */
    attempt: integer("attempt"),
    /** Reasoning tokens, where the provider reports them. Billed as output. */
    reasoningTokens: integer("reasoning_tokens"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_usage_at_idx").on(t.at),
    index("llm_usage_project_purpose_at_idx").on(t.projectId, t.purpose, t.at),
  ],
);

export const jobs = pgTable("jobs", {
  id: id(),
  kind: text("kind").notNull(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  progress: text("progress"),
  error: text("error"),
});

/**
 * Every paid action a user pressed: Scan now, a profile rebuild, a refresh.
 * The per-user allowance counts these, so one account looping a button runs
 * out of its own presses long before it can trip the house caps every other
 * user's scans share. Free's presses count for good, so rows are never pruned.
 */
export const userActions = pgTable(
  "user_actions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_actions_user_action_at_idx").on(t.userId, t.action, t.at)],
);
