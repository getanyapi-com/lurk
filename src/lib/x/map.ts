/**
 * twitter.search, twitter.tweet and twitter.profile each name the same facts
 * differently: search says `authorUsername` and `likeCount`, tweet says
 * `authorHandle` and `likes` (probe 2026-09-27, .context/x-module/probe). This
 * is the one place that knows both spellings, so nothing downstream does.
 * SDK 0.46.2 leaves several of these fields untyped, so every read is guarded
 * at runtime and a missing field is null, never a guess.
 */

/** One X post in the shape the module stores and judges. */
export type XPost = {
  id: string;
  text: string;
  lang: string | null;
  createdAt: Date;
  authorUsername: string;
  authorName: string | null;
  authorId: string | null;
  authorImage: string | null;
  authorFollowers: number | null;
  authorVerified: boolean | null;
  isReply: boolean;
  inReplyToId: string | null;
  conversationId: string | null;
  likeCount: number | null;
  replyCount: number | null;
  retweetCount: number | null;
  quoteCount: number | null;
  viewCount: number | null;
  bookmarkCount: number | null;
  mediaCount: number | null;
};

/** What twitter.profile says about an author. */
export type XAuthor = {
  username: string;
  authorId: string | null;
  name: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  accountCreatedAt: Date | null;
  verified: boolean | null;
  private: boolean | null;
  website: string | null;
  location: string | null;
};

type Raw = Record<string, unknown>;

function str(raw: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
    // An id can arrive as a number from a lane that parsed it; a snowflake above
    // 2^53 would already be corrupt, so only a safe integer is accepted.
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return String(value);
    }
  }
  return null;
}

function num(raw: Raw, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function bool(raw: Raw, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

/** Epoch seconds, which is what every twitter.* SKU returns for createdUtc. */
function epoch(raw: Raw, key: string): Date | null {
  const seconds = num(raw, key);
  return seconds === null ? null : new Date(seconds * 1000);
}

/**
 * X returns post text HTML-escaped ("pros &amp; cons", "Slack &gt; Photoshop").
 * Decoded once here, so the screen, the judge, the quote check and the card
 * all read what the author wrote. `&amp;` goes last, so "&amp;gt;" stays "&gt;".
 */
export function decodeXEntities(text: string): string {
  return text
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gu, "&");
}

/**
 * One post from a twitter.search item or a twitter.tweet payload, or null when
 * it lacks the id, text, author or time a post cannot be stored without.
 */
export function toXPost(value: unknown): XPost | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Raw;
  const id = str(raw, "id");
  const text = typeof raw.text === "string" ? decodeXEntities(raw.text) : null;
  const authorUsername = str(raw, "authorUsername", "authorHandle");
  const createdAt = epoch(raw, "createdUtc");
  if (!id || text === null || !authorUsername || !createdAt) {
    return null;
  }
  const inReplyToId = str(raw, "inReplyToId");
  const media = Array.isArray(raw.media) ? raw.media.length : null;
  return {
    id,
    text,
    lang: str(raw, "lang"),
    createdAt,
    authorUsername,
    authorName: str(raw, "authorName"),
    authorId: str(raw, "authorId"),
    authorImage: str(raw, "authorImage"),
    authorFollowers: num(raw, "authorFollowers"),
    authorVerified: bool(raw, "authorVerified"),
    isReply: bool(raw, "isReply") ?? inReplyToId !== null,
    inReplyToId,
    conversationId: str(raw, "conversationId"),
    likeCount: num(raw, "likeCount", "likes"),
    replyCount: num(raw, "replyCount", "replies"),
    retweetCount: num(raw, "retweetCount", "retweets", "repostCount"),
    quoteCount: num(raw, "quoteCount", "quotes"),
    viewCount: num(raw, "viewCount", "views"),
    bookmarkCount: num(raw, "bookmarkCount", "bookmarks"),
    mediaCount: media,
  };
}

/** The items of a twitter.search page, the ones that are whole posts. */
export function postsOfSearch(data: unknown): XPost[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map(toXPost).filter((post): post is XPost => post !== null);
}

/** The cursor a search page hands back, or null at the end of the walk. */
export function cursorOfSearch(data: unknown): string | null {
  const cursor = (data as { nextCursor?: unknown } | null)?.nextCursor;
  return typeof cursor === "string" && cursor !== "" ? cursor : null;
}

/** One author from a twitter.profile payload. */
export function toXAuthor(value: unknown, askedFor: string): XAuthor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Raw;
  const username = (str(raw, "handle", "username") ?? askedFor).toLowerCase();
  return {
    username,
    authorId: str(raw, "id"),
    name: str(raw, "displayName", "name"),
    bio: typeof raw.bio === "string" ? raw.bio : null,
    followers: num(raw, "followers"),
    following: num(raw, "following"),
    accountCreatedAt: epoch(raw, "createdUtc"),
    verified: bool(raw, "verified"),
    private: bool(raw, "private"),
    website: str(raw, "website"),
    location: str(raw, "location"),
  };
}

/**
 * A reply's own words: the run of @handles X puts in front of every reply is
 * who it answers, not what it says, so it is never quoted or judged as text.
 * 39% of AnyAPI's lead texts started with "@".
 */
export function ownText(text: string): string {
  return text.replace(/^(?:\s*@[A-Za-z0-9_]{1,15})+\s*/u, "").trim();
}

/**
 * What a post says in its author's own words: a reply without the handles it
 * answers, a top-level post as written. A post that opens by naming someone
 * ("@Hotjar alternatives that don't cost $200/mo?") is not a reply, and the
 * name is part of what it asks.
 */
export function ownWords(post: { text: string; isReply: boolean }): string {
  return post.isReply ? ownText(post.text) : post.text.trim();
}

/** The link a lead opens. The handle form, because it names who wrote it. */
export function canonicalUrl(username: string, id: string): string {
  return `https://x.com/${username}/status/${id}`;
}

/** The URL twitter.tweet is asked with; it reads the id out of the /status/ segment. */
export function lookupUrl(id: string): string {
  return `https://x.com/i/status/${id}`;
}
