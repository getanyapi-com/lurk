import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectKeywords } from "@/db/schema";
import { ALERT_SCORE_FLOOR } from "@/lib/alerts/select";
import { loadScanProject } from "./project";
import { runScan } from "./run";
import { KINDS, sweepSearchItems, type SweepSearch } from "./searches";

/**
 * How many searches a project that has none is given. A free scan asks eight,
 * so one scan covers them all; the first sweep's experiment found the best
 * eight by kind hold most of what twenty find.
 */
export const WIDEN_SEARCHES = 8;

/** The best `WIDEN_SEARCHES` of a sweep's searches: tool asks first, then rivals, and so on. */
export function pickSearches(items: SweepSearch[]): string[] {
  return [...items]
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
    .slice(0, WIDEN_SEARCHES)
    .map((item) => item.text);
}

/** Whether a project has any search its scans ask. Without one a scan reads listings only. */
export async function hasActiveSearch(projectId: string): Promise<boolean> {
  const rows = await db()
    .select({ id: projectKeywords.id })
    .from(projectKeywords)
    .where(
      and(
        eq(projectKeywords.projectId, projectId),
        inArray(projectKeywords.state, ["active", "pinned"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Gives a project that has no searches the sweep's best few, and scans once.
 * Projects set up before the first sweep kept its searches (2026-09-19) read
 * only their subreddits' listings, which turn a candidate into a lead about a
 * ninth as often as a search does. The searches go in never covered, so the
 * scan asks each over the last month; it runs here rather than as a queued
 * scan because a project nobody attends has its scans held.
 */
export async function widenSearches(projectId: string, jobId: string): Promise<number> {
  if (await hasActiveSearch(projectId)) {
    return 0;
  }
  const project = await loadScanProject(projectId);
  if (!project) {
    return 0;
  }
  const searches = pickSearches(await sweepSearchItems(projectId, project.product));
  if (searches.length === 0) {
    return 0;
  }
  await db()
    .insert(projectKeywords)
    .values(
      searches.map((keyword) => ({ projectId, keyword, source: "sweep", state: "active" })),
    )
    .onConflictDoNothing();
  await runScan(projectId, jobId);
  return searches.length;
}

/**
 * Projects owed searches at boot: set up, no search of their own, no alert
 * channel on the owner, no lead posted in the last month, and never widened.
 * Anyone else gets theirs when they turn alerts on (lib/alerts/invite.ts).
 */
export async function projectsOwedSearches(now: Date): Promise<string[]> {
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db().execute<{ id: string }>(sql`
    select p.id from projects p
    where p.discovered_at is not null
      and not exists (select 1 from project_keywords k
        where k.project_id = p.id and k.state in ('active', 'pinned'))
      and not exists (select 1 from alerts a join projects ap on ap.id = a.project_id
        where ap.user_id = p.user_id)
      and not exists (select 1 from jobs j where j.project_id = p.id and j.kind = 'widen_searches')
      and not exists (select 1 from leads l
        join reddit_posts rp on rp.id = l.post_id
        left join reddit_comments rc on rc.id = l.comment_id
        where l.project_id = p.id and l.kind = 'buyer' and l.status = 'new'
          and l.score >= ${ALERT_SCORE_FLOOR}
          and coalesce(rc.created_at, rp.created_at) >= ${month})
    order by p.created_at
  `);
  return [...rows].map((row) => row.id);
}
