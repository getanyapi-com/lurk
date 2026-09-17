import { db } from "@/db";
import { competitorMentions } from "@/db/schema/competitors";
import type { StoredComment, StoredPost } from "@/lib/reddit/store";
import { competitorsNamed, quoteNaming } from "./match";

/**
 * Competitor mentions found inside a thread this project already reads: a
 * lead's own thread, or a thread Google ranks for one of its phrasings. The
 * thread was bought for the lead or the SEO tab; naming who else is being
 * recommended in it costs nothing more than a string match.
 */

export type ThreadMention = {
  projectId: string;
  competitor: string;
  postId: string;
  /** Null when the post itself named the competitor. */
  commentId: string | null;
  quote: string | null;
};

export type Thread = { post: StoredPost; comments: StoredComment[] };

/** Every competitor the post and each reply names, one row per competitor per place. */
export function threadMentions(
  projectId: string,
  competitors: string[],
  thread: Thread,
): ThreadMention[] {
  const rows: ThreadMention[] = [];
  const postText = `${thread.post.title}\n${thread.post.body ?? ""}`;
  for (const competitor of competitorsNamed(competitors, postText)) {
    rows.push({
      projectId,
      competitor,
      postId: thread.post.id,
      commentId: null,
      quote: quoteNaming(postText, competitor),
    });
  }
  for (const comment of thread.comments) {
    const body = comment.body ?? "";
    for (const competitor of competitorsNamed(competitors, body)) {
      rows.push({
        projectId,
        competitor,
        postId: thread.post.id,
        commentId: comment.id,
        quote: quoteNaming(body, competitor),
      });
    }
  }
  return rows;
}

/** The competitors named anywhere in the thread, each once, in list order. */
export function competitorsInThread(competitors: string[], thread: Thread): string[] {
  const named = new Set(threadMentions("", competitors, thread).map((row) => row.competitor));
  return competitors.filter((name) => named.has(name));
}

/**
 * Writes what the threads named. A place already recorded for that competitor
 * is left as it was: the first read's quote is as true as the last one's.
 */
export async function writeThreadMentions(
  projectId: string,
  competitors: string[],
  threads: Thread[],
): Promise<number> {
  const rows = threads.flatMap((thread) => threadMentions(projectId, competitors, thread));
  if (rows.length === 0) {
    return 0;
  }
  const written = await db()
    .insert(competitorMentions)
    .values(rows.map((row) => ({ ...row, foundAt: new Date() })))
    .onConflictDoNothing()
    .returning({ id: competitorMentions.id });
  return written.length;
}
