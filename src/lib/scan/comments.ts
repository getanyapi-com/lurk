import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { leadEvaluations, redditPosts } from "@/db/schema";
import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchPostComments } from "@/lib/reddit/skus";
import type { StoredComment, StoredPost } from "@/lib/reddit/store";
import {
  alreadyJudged,
  contentHash,
  digestComments,
  postHash,
  type EvaluationRecord,
  type StoredJudgement,
} from "./evaluations";
import type { Judgement, ScorableItem } from "./judgement";
import { leadKey } from "./leads";
import { inFlight } from "./constants";
import type { ScanProject } from "./project";
import { judgeItems } from "./score";

/**
 * What a thread is read for. Verification asks whether the post's own need is
 * still open now that its replies are known; discovery asks whether anyone else
 * in the thread has a need of their own. One fetch serves both, so the thread
 * budget is a reading budget and each purpose spends its own model call.
 */

const HOUR_MS = 60 * 60 * 1000;

export type ThreadRead = { post: StoredPost; comments: StoredComment[] };

/** Reads each thread, keeping the ones that answered. A failure loses one. */
export async function readThreads(
  ctx: FetchContext,
  posts: StoredPost[],
): Promise<{ threads: ThreadRead[]; failures: number }> {
  const reads = await inFlight(posts, async (post): Promise<ThreadRead | null> => {
    try {
      const result = await fetchPostComments(ctx, post.id, post.url);
      return { post, comments: result.value };
    } catch {
      return null;
    }
  });
  const threads = reads.filter((read): read is ThreadRead => read !== null);
  return { threads, failures: reads.length - threads.length };
}

/**
 * The held candidates a thread could settle: the ones the judge sent to review
 * because the post alone did not say enough. Their own replies are the only
 * place that answer exists, so they get a bounded read of their own after the
 * qualified leads have had theirs. Newest first, because a stale question is
 * the least worth spending the last of the budget on.
 */
export async function heldForComments(
  projectId: string,
  budget: number | null,
  windowMs: number,
  exclude: string[] = [],
): Promise<StoredPost[]> {
  if (budget === 0) {
    return [];
  }
  const rows = await db()
    .select({ post: redditPosts })
    .from(leadEvaluations)
    .innerJoin(redditPosts, eq(redditPosts.id, leadEvaluations.postId))
    .where(
      and(
        eq(leadEvaluations.projectId, projectId),
        eq(leadEvaluations.decision, "review"),
        sql`${leadEvaluations.commentId} is null`,
        sql`'insufficient_evidence' = any(${leadEvaluations.reasonCodes})`,
        gte(redditPosts.createdAt, new Date(Date.now() - windowMs)),
      ),
    )
    .orderBy(desc(redditPosts.createdAt));
  const held = rows.map((row) => row.post).filter((post) => !exclude.includes(post.id));
  return budget === null ? held : held.slice(0, budget);
}

function block(title: string, lines: string[]): string {
  return lines.length === 0 ? "" : `\n\n${title}\n${lines.join("\n")}`;
}

/** The post's own text, plus what its author said next and what others answered. */
export function verificationText(thread: ThreadRead): string {
  const follow = thread.comments
    .filter((comment) => comment.author && comment.author === thread.post.author)
    .map((comment) => `- ${comment.body ?? ""}`);
  const answers = [...thread.comments]
    .filter((comment) => comment.author !== thread.post.author)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((comment) => `- u/${comment.author ?? "unknown"}: ${comment.body ?? ""}`);
  return [
    thread.post.body ?? "",
    block("The author said this later in the thread:", follow),
    block("Answers others gave in the thread:", answers),
  ].join("");
}

function verificationItem(thread: ThreadRead): ScorableItem {
  return {
    id: thread.post.id,
    title: thread.post.title,
    subreddit: thread.post.subreddit,
    body: verificationText(thread),
    author: thread.post.author,
    ageHours: (Date.now() - thread.post.createdAt.getTime()) / HOUR_MS,
    upvotes: thread.post.score,
    numComments: thread.post.numComments,
    parentBody: null,
  };
}

/**
 * One buyer per author per thread. A person who wrote four comments is one
 * opportunity, and the comment carrying the most of their own words is the one
 * with the evidence, so that is the one judged.
 */
export function representativeComments(thread: ThreadRead): StoredComment[] {
  const best = new Map<string, StoredComment>();
  for (const comment of thread.comments) {
    if (!comment.author || comment.author === thread.post.author || !comment.body) {
      continue;
    }
    const held = best.get(comment.author);
    if (!held || (held.body ?? "").length < comment.body.length) {
      best.set(comment.author, comment);
    }
  }
  return [...best.values()];
}

function discoveryItem(thread: ThreadRead, comment: StoredComment): ScorableItem {
  return {
    id: comment.id,
    title: thread.post.title,
    subreddit: thread.post.subreddit,
    body: comment.body ?? "",
    author: comment.author,
    ageHours: (Date.now() - comment.createdAt.getTime()) / HOUR_MS,
    upvotes: comment.score,
    numComments: thread.post.numComments,
    parentBody: thread.post.body ?? "",
  };
}

export type ThreadJudgements = {
  verification: { post: StoredPost; judgement: Judgement }[];
  discovery: { postId: string; comment: StoredComment; judgement: Judgement }[];
  records: EvaluationRecord[];
};

const EMPTY: ThreadJudgements = { verification: [], discovery: [], records: [] };

function record(
  project: ScanProject,
  postId: string,
  commentId: string | null,
  judgement: Judgement,
  hash: string,
): EvaluationRecord {
  return {
    projectId: project.id,
    postId,
    commentId,
    judgement,
    profileVersion: project.profileVersion,
    contentHash: hash,
  };
}

/**
 * Judges what the threads said, in two passes with separate model calls: the
 * posts again with their replies known, and every other participant's own need.
 * A candidate whose text and product profile have not changed is skipped.
 *
 * A comment is judged once per scan however many threads carry it. Two threads
 * can carry one comment: a comment keeps the post it was first stored under, so
 * an upstream that answers a crosspost with the original thread's replies hands
 * the same comment back under a second post. Judging it twice would spend a
 * second model call on the same text and give one comment two verdicts, which
 * is one row too many for the verdict a project holds per comment.
 */
export async function judgeThreads(
  project: ScanProject,
  threads: ThreadRead[],
  stored: Map<string, StoredJudgement>,
): Promise<ThreadJudgements> {
  if (threads.length === 0) {
    return EMPTY;
  }
  const verifyItems: ScorableItem[] = [];
  const verifyHashes = new Map<string, string>();
  const discoverItems: ScorableItem[] = [];
  const discoverHashes = new Map<string, string>();
  const commentOf = new Map<string, { postId: string; comment: StoredComment }>();
  const postOf = new Map(threads.map((thread) => [thread.post.id, thread.post]));

  for (const thread of threads) {
    const item = verificationItem(thread);
    const hash = postHash(thread.post.title, thread.post.body, digestComments(thread.comments));
    if (!alreadyJudged(stored, leadKey(thread.post.id, null), project.profileVersion, hash)) {
      verifyItems.push(item);
      verifyHashes.set(thread.post.id, hash);
    }
    for (const comment of representativeComments(thread)) {
      const own = discoveryItem(thread, comment);
      const commentHash = contentHash([own.title, own.parentBody, own.body]);
      if (
        commentOf.has(comment.id) ||
        alreadyJudged(stored, leadKey(thread.post.id, comment.id), project.profileVersion, commentHash)
      ) {
        continue;
      }
      discoverItems.push(own);
      discoverHashes.set(comment.id, commentHash);
      commentOf.set(comment.id, { postId: thread.post.id, comment });
    }
  }

  const verified = await judgeItems(project.id, project.product, verifyItems);
  const discovered = await judgeItems(project.id, project.product, discoverItems);
  return {
    verification: verified.map((judgement) => ({
      post: postOf.get(judgement.id) as StoredPost,
      judgement,
    })),
    discovery: discovered.map((judgement) => ({
      postId: commentOf.get(judgement.id)?.postId as string,
      comment: commentOf.get(judgement.id)?.comment as StoredComment,
      judgement,
    })),
    records: [
      ...verified.map((judgement) =>
        record(project, judgement.id, null, judgement, verifyHashes.get(judgement.id) as string),
      ),
      ...discovered.map((judgement) =>
        record(
          project,
          commentOf.get(judgement.id)?.postId as string,
          judgement.id,
          judgement,
          discoverHashes.get(judgement.id) as string,
        ),
      ),
    ],
  };
}
