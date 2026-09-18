import { eq } from "drizzle-orm";
import { db } from "@/db";
import { redditAuthors, subreddits } from "@/db/schema";
import {
  fetchShared,
  normalizeQuery,
  variantOf,
  type FetchContext,
  type SharedResult,
} from "./fetch";
import {
  commentsOfPost,
  cursorOfRun,
  linkRunPosts,
  postsOfRun,
  upsertComments,
  upsertPosts,
  type RawComment,
  type RawPost,
  type StoredComment,
  type StoredPost,
} from "./store";

/** One function per Reddit endpoint the scan uses, all sharing one run store. */

/**
 * No listing asks for the closed-thread flags. Only the Reddit SEO pages read
 * them, and those threads come from Google results opened with `reddit.post`,
 * which every source serving it returns the flags for. Asking a listing for
 * them by name pinned every page to the one source that reports them, at a
 * third more per page and one vendor's rate limit for the whole sweep
 * (measured 2026-09-17: 210 of 210 search pages).
 */

type RawPage = { posts?: RawPost[]; nextCursor?: string | null } | null;

/** One page of a listing or a search: its posts, and where the walk continues. */
export type PostPage = { posts: StoredPost[]; nextCursor: string | null };

async function storePosts(data: unknown, runId: string): Promise<StoredPost[]> {
  const posts = ((data as RawPage)?.posts ?? []) as RawPost[];
  const stored = await upsertPosts(posts);
  await linkRunPosts(
    runId,
    stored.map((post) => post.id),
  );
  return stored;
}

async function storePage(data: unknown, runId: string): Promise<PostPage> {
  return { posts: await storePosts(data, runId), nextCursor: (data as RawPage)?.nextCursor ?? null };
}

async function loadPage(runId: string): Promise<PostPage> {
  return { posts: await postsOfRun(runId), nextCursor: await cursorOfRun(runId) };
}

/**
 * Keyword search is sorted by relevance, not by new. Measured on 2026-09-05:
 * "Typeform alternatives" over one week returned 1 unrelated post sorted new
 * and 7 on-topic ones sorted by relevance, so newest-first threw the leads away
 * and left the title prefilter nothing to keep. The timeframe already bounds
 * how old a result can be. A caller sweeping a year wants both orders, so the
 * sort is theirs to pick and is part of the run key: relevance and new are two
 * different pages of the same query and must never serve each other.
 */
export async function fetchSearch(
  ctx: FetchContext,
  query: string,
  options: {
    timeframe: "day" | "week" | "month" | "year";
    sort?: "relevance" | "new";
    cursor?: string;
  },
): Promise<SharedResult<PostPage>> {
  const { timeframe, cursor } = options;
  const sort = options.sort ?? "relevance";
  return fetchShared<PostPage>({
    ctx,
    kind: "keyword",
    sku: "reddit.search",
    normalizedQuery: normalizeQuery(query),
    sort,
    timeframe,
    variant: variantOf({ cursor }),
    run: async () => {
      const res = await ctx.funded.client.reddit.search({
        query,
        sort,
        timeframe,
        ...(cursor ? { cursor } : {}),
      });
      const data = res.output.found ? res.output.data : null;
      return { data, costUsd: res.costUsd, nextCursor: data?.nextCursor ?? null };
    },
    store: storePage,
    load: loadPage,
  });
}

/**
 * A community's own listing, newest first, one page per call. The page cursor
 * and the requested size are part of the run key, so page two never serves a
 * caller who asked for page one.
 */
export async function fetchSubredditPosts(
  ctx: FetchContext,
  subreddit: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<SharedResult<PostPage>> {
  const { cursor, limit } = options;
  return fetchShared<PostPage>({
    ctx,
    kind: "subreddit_posts",
    sku: "reddit.subreddit_posts",
    normalizedQuery: normalizeQuery(subreddit),
    sort: "new",
    variant: variantOf({ cursor, limit }),
    run: async () => {
      const res = await ctx.funded.client.reddit.subredditPosts({
        subreddit,
        sort: "new",
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      });
      const data = res.output.found ? res.output.data : null;
      return { data, costUsd: res.costUsd, nextCursor: data?.nextCursor ?? null };
    },
    store: storePage,
    load: loadPage,
  });
}

export async function fetchPost(
  ctx: FetchContext,
  url: string,
  maxAgeMs: number,
): Promise<SharedResult<StoredPost[]>> {
  return fetchShared<StoredPost[]>({
    ctx,
    kind: "post",
    sku: "reddit.post",
    normalizedQuery: url,
    maxAgeMs,
    run: async () => {
      const res = await ctx.funded.client.reddit.post({ url });
      return { data: res.output.found ? { posts: [res.output.data] } : null, costUsd: res.costUsd };
    },
    store: storePosts,
    load: postsOfRun,
  });
}

export async function fetchPostComments(
  ctx: FetchContext,
  postId: string,
  url: string,
): Promise<SharedResult<StoredComment[]>> {
  return fetchShared<StoredComment[]>({
    ctx,
    kind: "comments",
    sku: "reddit.post_comments",
    normalizedQuery: postId,
    run: async () => {
      const res = await ctx.funded.client.reddit.postComments({ url });
      return { data: res.output.found ? res.output.data : null, costUsd: res.costUsd };
    },
    store: async (data) => {
      const comments = ((data as { comments?: RawComment[] } | null)?.comments ?? []) as RawComment[];
      return upsertComments(postId, comments);
    },
    load: async () => commentsOfPost(postId),
  });
}

export type SubredditFacts = {
  name: string;
  weeklyActiveUsers: number;
  description: string;
  iconUrl?: string;
} | null;

/** Subreddit metadata, kept for a week because a sidebar rarely changes. */
export async function fetchSubredditDetails(
  ctx: FetchContext,
  subreddit: string,
  maxAgeMs: number,
): Promise<SharedResult<SubredditFacts>> {
  return fetchShared<SubredditFacts>({
    ctx,
    kind: "subreddit",
    sku: "reddit.subreddit_details",
    normalizedQuery: normalizeQuery(subreddit),
    maxAgeMs,
    run: async () => {
      const res = await ctx.funded.client.reddit.subredditDetails({ subreddit });
      return { data: res.output.found ? res.output.data : null, costUsd: res.costUsd };
    },
    store: async (data) => {
      const facts = data as SubredditFacts;
      if (!facts) {
        return null;
      }
      await db()
        .insert(subreddits)
        .values({
          name: normalizeQuery(subreddit),
          subscribers: facts.weeklyActiveUsers,
          rulesText: facts.description,
          iconUrl: facts.iconUrl ?? null,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: subreddits.name,
          set: {
            subscribers: facts.weeklyActiveUsers,
            rulesText: facts.description,
            iconUrl: facts.iconUrl ?? null,
            fetchedAt: new Date(),
          },
        });
      return facts;
    },
    load: async () => {
      const rows = await db()
        .select()
        .from(subreddits)
        .where(eq(subreddits.name, normalizeQuery(subreddit)));
      const row = rows[0];
      return row
        ? {
            name: row.name,
            weeklyActiveUsers: row.subscribers ?? 0,
            description: row.rulesText ?? "",
            iconUrl: row.iconUrl ?? undefined,
          }
        : null;
    },
  });
}

export type AuthorFace = {
  username: string;
  avatarUrl: string | null;
  karma: number | null;
  accountCreatedAt: Date | null;
} | null;

/**
 * One Reddit account's public facts, kept a month. Called only for authors whose
 * post already became a lead, so the cost follows leads and not candidates. The
 * karma and the account age ride along on that same call and cost nothing more.
 */
export async function fetchAuthorProfile(
  ctx: FetchContext,
  username: string,
  maxAgeMs: number,
): Promise<SharedResult<AuthorFace>> {
  const key = normalizeQuery(username);
  return fetchShared<AuthorFace>({
    ctx,
    kind: "profile",
    sku: "reddit.profile",
    normalizedQuery: key,
    maxAgeMs,
    run: async () => {
      const res = await ctx.funded.client.reddit.profile({ username });
      return { data: res.output.found ? res.output.data : null, costUsd: res.costUsd };
    },
    store: async (data) => {
      const profile = data as
        | { username?: string; avatarUrl?: string; karma?: number; createdUtc?: number }
        | null;
      if (!profile) {
        return null;
      }
      const values = {
        username: key,
        avatarUrl: profile.avatarUrl ?? null,
        karma: profile.karma ?? null,
        // `createdUtc` is Unix seconds, as the reddit.profile schema states.
        accountCreatedAt:
          profile.createdUtc === undefined ? null : new Date(profile.createdUtc * 1000),
        fetchedAt: new Date(),
      };
      await db()
        .insert(redditAuthors)
        .values(values)
        .onConflictDoUpdate({ target: redditAuthors.username, set: values });
      return {
        username: key,
        avatarUrl: values.avatarUrl,
        karma: values.karma,
        accountCreatedAt: values.accountCreatedAt,
      };
    },
    load: async () => {
      const rows = await db()
        .select()
        .from(redditAuthors)
        .where(eq(redditAuthors.username, key));
      const row = rows[0];
      return row
        ? {
            username: row.username,
            avatarUrl: row.avatarUrl,
            karma: row.karma,
            accountCreatedAt: row.accountCreatedAt,
          }
        : null;
    },
  });
}
