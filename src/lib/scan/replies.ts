import { sql } from "drizzle-orm";
import { db } from "@/db";
import { houseClient } from "@/lib/anyapi";
import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchPostComments } from "@/lib/reddit/skus";
import { inFlight } from "./constants";
import { demoteLeads } from "./leads";
import { loadScanProject } from "./project";

/**
 * Reply leads judged before comments carried their parent. A thread holding
 * one is read again, fresh, so its comments learn what they answer; then every
 * lead on a reply to another comment is withdrawn, since only a comment that
 * answers the post is judged now. Runs once per project that has any.
 */

/** Projects holding a new reply lead whose comment's parent is unknown. */
export async function projectsOwedReplyParents(): Promise<string[]> {
  const rows = await db().execute<{ project_id: string }>(sql`
    select distinct l.project_id from leads l
    join reddit_comments rc on rc.id = l.comment_id
    where l.status = 'new' and rc.parent_id is null
      and not exists (select 1 from jobs j where j.project_id = l.project_id and j.kind = 'reply_parents')
  `);
  return [...rows].map((row) => row.project_id);
}

export async function settleReplyParents(projectId: string): Promise<{ read: number; withdrawn: number }> {
  const project = await loadScanProject(projectId);
  if (!project) {
    return { read: 0, withdrawn: 0 };
  }
  const threads = await db().execute<{ id: string; url: string }>(sql`
    select distinct rp.id, rp.url from leads l
    join reddit_comments rc on rc.id = l.comment_id
    join reddit_posts rp on rp.id = l.post_id
    where l.project_id = ${projectId} and l.status = 'new' and rc.parent_id is null
  `);
  // Fresh, because a stored read from before the parent field has none; on
  // the house key, because this fixes our mistake and no user asked for it.
  const ctx: FetchContext = { projectId, funded: houseClient(), maxAgeMs: 0 };
  const reads = await inFlight([...threads], async (thread) => {
    try {
      await fetchPostComments(ctx, thread.id, thread.url);
      return true;
    } catch {
      return false;
    }
  });
  const nested = await db().execute<{ post_id: string; comment_id: string }>(sql`
    select l.post_id, l.comment_id from leads l
    join reddit_comments rc on rc.id = l.comment_id
    where l.project_id = ${projectId} and l.status = 'new'
      and rc.parent_id is not null and rc.parent_id <> l.post_id
  `);
  const withdrawn = await demoteLeads(
    projectId,
    [...nested].map((row) => ({ postId: row.post_id, commentId: row.comment_id })),
  );
  return { read: reads.filter(Boolean).length, withdrawn };
}
