import type { FetchContext } from "@/lib/reddit/fetch";
import { PARENT_CHARS, PARENT_LIMIT } from "./constants";
import { ownWords } from "./map";
import { fetchProfile, fetchTweet } from "./skus";
import { xPostsById, type StoredXPost } from "./store";

/**
 * What a post answers, bought before it is judged. On X a reply arrives
 * without its parent, and replies were 54% of the leads people agreed on in
 * AnyAPI's scanner: "@user is it expensive or not?" is a lead only beside what
 * it answers. The parent is walked one twitter.tweet call ($0.00022) per hop,
 * which is how xleads replaced twitter.thread: that endpoint returns only the
 * author's own continuation posts, at 17x the price.
 */

export type ReplyContext = {
  /** The nearest posts by other people, oldest first, as `@handle: text`. */
  replyingTo: string[];
  /** Those same posts as stored, which a scan may judge in their own right (run.ts judgeThread). */
  parents: StoredXPost[];
  /** The author's own earlier posts in the chain, oldest first: one post split across several. */
  selfThread: string[];
  /** A parent X no longer serves, so the post can be held at best. */
  chainIncomplete: boolean;
  /** Paid lookups this walk made (reused runs are free and not counted). */
  bought: number;
  costUsd: number;
};

/** A walk that failed partway, carrying how many lookups it had already bought and the error itself. */
export class ParentWalkError extends Error {
  constructor(
    readonly bought: number,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ParentWalkError";
  }
}

function sameAuthor(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

type Hop = { parent: StoredXPost | null; bought: boolean; costUsd: number };

async function walk(
  post: Pick<StoredXPost, "authorUsername" | "inReplyToId">,
  hops: number,
  step: (id: string) => Promise<Hop | "missing">,
): Promise<ReplyContext | null> {
  const others: StoredXPost[] = [];
  const selfThread: string[] = [];
  let bought = 0;
  let costUsd = 0;
  let chainIncomplete = false;
  let next = post.inReplyToId;
  for (let hop = 0; hop < hops && next; hop += 1) {
    let result;
    try {
      result = await step(next);
    } catch (error) {
      throw new ParentWalkError(bought, error);
    }
    if (result === "missing") {
      return null;
    }
    if (result.bought) {
      bought += 1;
      costUsd += result.costUsd;
    }
    const parent = result.parent;
    if (!parent || parent.unavailableAt) {
      chainIncomplete = true;
      break;
    }
    if (sameAuthor(parent.authorUsername, post.authorUsername)) {
      selfThread.unshift(ownWords(parent));
    } else {
      others.unshift(parent);
      if (others.length >= PARENT_LIMIT) {
        break;
      }
    }
    next = parent.inReplyToId;
  }
  return {
    replyingTo: others.map((parent) => `@${parent.authorUsername}: ${ownWords(parent).slice(0, PARENT_CHARS)}`),
    parents: others,
    selfThread,
    chainIncomplete,
    bought,
    costUsd,
  };
}

/** Walks a reply up to `hops` posts, stopping once two parents by other people are known. */
export async function walkParents(
  ctx: FetchContext,
  post: Pick<StoredXPost, "authorUsername" | "inReplyToId">,
  hops: number,
): Promise<ReplyContext> {
  const result = await walk(post, hops, async (id) => {
    const fetched = await fetchTweet(ctx, id);
    return { parent: fetched.value, bought: !fetched.reused, costUsd: fetched.costUsd };
  });
  // The paid step never answers "missing".
  return result as ReplyContext;
}

/**
 * The same walk from posts already stored, buying nothing, or null when a post
 * on the way is not stored. A thread's post found through a reply usually has
 * its chain stored already: the reply's own walk just bought it.
 */
export async function storedParents(
  post: Pick<StoredXPost, "authorUsername" | "inReplyToId">,
  hops: number,
): Promise<ReplyContext | null> {
  return walk(post, hops, async (id) => {
    const stored = (await xPostsById([id])).get(id);
    return stored ? { parent: stored, bought: false, costUsd: 0 } : "missing";
  });
}

/** A post's own words with the author's earlier posts in the chain joined above it. */
export function joinedText(post: { text: string; isReply: boolean }, selfThread: string[]): string {
  return [...selfThread, ownWords(post)].filter(Boolean).join("\n\n");
}

/** The author's bio, bought once per handle a week. */
export async function buyBio(
  ctx: FetchContext,
  username: string,
): Promise<{ bio: string | null; bought: boolean; costUsd: number }> {
  const result = await fetchProfile(ctx, username);
  return { bio: result.value?.bio ?? null, bought: !result.reused, costUsd: result.costUsd };
}
