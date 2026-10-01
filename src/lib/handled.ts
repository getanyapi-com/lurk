import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { handledThreads, leads, xLeads } from "@/db/schema";
import { forgetProjectFeed } from "@/lib/projectFeedCache";

/** Where a thread lives. On Reddit it is a post, on X a conversation. */
export type ThreadPlatform = "reddit" | "x";

export function isThreadPlatform(value: string): value is ThreadPlatform {
  return value === "reddit" || value === "x";
}

/** An X lead in a conversation, or the post itself when it was stored with none. */
function inXThread(threadId: string) {
  return or(eq(xLeads.conversationId, threadId), eq(xLeads.tweetId, threadId));
}

/**
 * The owner answered this thread: every lead in it still at `new` becomes
 * `replied`, and the thread is remembered so a lead found in it later is born
 * that way. A lead they hid or called a miss keeps what they said.
 */
export async function markThreadReplied(
  projectId: string,
  platform: ThreadPlatform,
  threadId: string,
): Promise<void> {
  await db()
    .insert(handledThreads)
    .values({ projectId, platform, threadId })
    .onConflictDoNothing();
  if (platform === "reddit") {
    await db()
      .update(leads)
      .set({ status: "replied" })
      .where(and(eq(leads.projectId, projectId), eq(leads.postId, threadId), eq(leads.status, "new")));
  } else {
    await db()
      .update(xLeads)
      .set({ status: "replied" })
      .where(
        and(eq(xLeads.projectId, projectId), inXThread(threadId), eq(xLeads.status, "new")),
      );
  }
  forgetProjectFeed(projectId);
}

/**
 * Takes it back: the thread is forgotten and its `replied` leads are new again.
 * Their `foundAt` is untouched, so an alert window that already passed them
 * does not send them a second time.
 */
export async function reopenThread(
  projectId: string,
  platform: ThreadPlatform,
  threadId: string,
): Promise<void> {
  await db()
    .delete(handledThreads)
    .where(
      and(
        eq(handledThreads.projectId, projectId),
        eq(handledThreads.platform, platform),
        eq(handledThreads.threadId, threadId),
      ),
    );
  if (platform === "reddit") {
    await db()
      .update(leads)
      .set({ status: "new" })
      .where(and(eq(leads.projectId, projectId), eq(leads.postId, threadId), eq(leads.status, "replied")));
  } else {
    await db()
      .update(xLeads)
      .set({ status: "new" })
      .where(
        and(eq(xLeads.projectId, projectId), inXThread(threadId), eq(xLeads.status, "replied")),
      );
  }
  forgetProjectFeed(projectId);
}

/**
 * Settles the leads a scan just wrote: one that landed in a thread the owner
 * already answered is `replied` from the start, so it never reaches the feed's
 * New list or a digest.
 */
export async function settleRepliedThreads(projectIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) {
    return;
  }
  await db()
    .update(leads)
    .set({ status: "replied" })
    .where(
      and(
        inArray(leads.projectId, ids),
        eq(leads.status, "new"),
        sql`exists (
          select 1 from ${handledThreads}
          where ${handledThreads.projectId} = ${leads.projectId}
            and ${handledThreads.platform} = 'reddit'
            and ${handledThreads.threadId} = ${leads.postId}
        )`,
      ),
    );
}

/** The Reddit thread a lead sits in, or null when the lead is not this project's. */
export async function redditLeadThread(projectId: string, leadId: string): Promise<string | null> {
  const [row] = await db()
    .select({ postId: leads.postId })
    .from(leads)
    .where(and(eq(leads.projectId, projectId), eq(leads.id, leadId)))
    .limit(1);
  return row?.postId ?? null;
}
