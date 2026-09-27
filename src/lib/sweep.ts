import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import type { ProjectActivity } from "@/lib/projectActivity";
import { candidateSources, jobs, leadEvaluations, leads, redditPosts } from "@/db/schema";
import { newLeadCount } from "@/lib/leads";

/**
 * A project's first sweep as it is happening: the one line the leads page
 * reports it in, and the types the recorded board in src/app/prototype replays. The sweep reads a title first and scores only the posts
 * whose title asks for something, so a found post ends one of two ways: set
 * aside on its title, or read in full and given a verdict.
 */

/** What Jev said about a post it read in full. */
export type SweepVerdict = {
  decision: "qualify" | "review" | "reject";
  score: number;
  relationship: string;
  needState: string;
  fit: number | null;
  intent: number | null;
  quote: string | null;
};

/** One thread the sweep is finished with. No verdict means its title asked for nothing. */
export type SweepThread = {
  id: string;
  title: string;
  subreddit: string;
  /** Absent from the recorded replay, which was taken before they were read. */
  author?: string | null;
  url?: string;
  body: string | null;
  ups: number | null;
  comments: number | null;
  createdAt: string;
  verdict: SweepVerdict | null;
};

export type SweepCounts = {
  /** Distinct posts the searches have turned up. */
  found: number;
  /** Titles Jev has read. */
  triaged: number;
  /** Posts read in full and given a verdict. */
  scored: number;
  /** Set aside on the title alone. */
  asideAtTitle: number;
  buyers: number;
  review: number;
  leads: number;
};

export type SweepSnapshot = {
  state: "waiting" | "running" | "done" | "stopped";
  /** The job's own progress line, which names the pass it is on. */
  progress: string | null;
  elapsedMs: number;
  counts: SweepCounts;
  /** Typed answers Jev has given: two a title, five a post read in full. */
  answers: number;
  costUsd: number;
  /** The newest threads the sweep is finished with, newest first. */
  threads: SweepThread[];
  /**
   * Leads waiting in the feed. Not the funnel's last band: a post held for
   * review can still be routed into the feed, so this is the number the feed
   * under the board will show, and the one a summary of the sweep has to match.
   */
  feedLeads: number;
};

/** How long a sweep that has ended still says so over the feed, so its last line can be read. */
const SWEEP_LINGER_MS = 90 * 1000;

/** Whether the leads page reports the sweep: while it is queued or running, and just after. */
export function sweepShown(activity: ProjectActivity, now = new Date()): boolean {
  // The setup that comes before the sweep counts too: a new project lands here,
  // and the line says what is being read until the first leads are in.
  if (activity.active.some((job) => job.kind === "backfill" || job.kind === "discovery_initial")) {
    return true;
  }
  const last = activity.last;
  return (
    last?.kind === "backfill" &&
    last.finishedAt !== null &&
    now.getTime() - last.finishedAt.getTime() < SWEEP_LINGER_MS
  );
}

/**
 * A project's first sweep as the leads page reports it, over the feed it is
 * filling: which part of the work it is on, and how many leads it has put in
 * the feed so far. Read once a second while it runs, so it is two counts and
 * a row, not the threads themselves.
 */
export type SweepStatus = {
  state: SweepSnapshot["state"];
  /** The progress line of whichever job is working: the setup, then the sweep. */
  progress: string | null;
  elapsedMs: number;
  /** Distinct posts the sweep's searches have turned up. */
  found: number;
  /** Leads waiting in the feed, which is the number the list under this shows. */
  feedLeads: number;
};

/** The first sweep this project has queued, running or ended, as it stands now. */
export async function sweepStatus(projectId: string): Promise<SweepStatus | null> {
  const [job] = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, "backfill")))
    .orderBy(desc(jobs.runAt))
    .limit(1);
  if (!job?.startedAt) {
    const [setup] = job
      ? []
      : await db()
          .select({ progress: jobs.progress })
          .from(jobs)
          .where(
            and(eq(jobs.projectId, projectId), eq(jobs.kind, "discovery_initial"), isNull(jobs.finishedAt)),
          )
          .limit(1);
    if (!job && !setup) {
      return null;
    }
    return { state: "waiting", progress: setup?.progress ?? null, elapsedMs: 0, found: 0, feedLeads: 0 };
  }
  const start = job.startedAt;
  const [[found], feedLeads] = await Promise.all([
    db()
      .select({ n: sql<number>`count(distinct ${candidateSources.postId})::int` })
      .from(candidateSources)
      .where(and(eq(candidateSources.projectId, projectId), gte(candidateSources.firstSeenAt, start))),
    newLeadCount(projectId),
  ]);
  return {
    state: job.error ? "stopped" : job.finishedAt ? "done" : "running",
    progress: job.progress,
    elapsedMs: (job.finishedAt ?? new Date()).getTime() - start.getTime(),
    found: found.n,
    feedLeads,
  };
}

/**
 * One thread the sweep drew, in full: the snapshot carries only the opening of
 * each body, since it is read every second for hundreds of threads. Only a
 * post this project's searches found can be read. `entry` is how the feed
 * names it, once it is there: `lead-` for a lead, `held-` for a thread held for
 * review, which is never a lead but opens in the same pane.
 */
export async function sweepThreadDetail(
  projectId: string,
  postId: string,
): Promise<{ body: string | null; entry: string | null } | null> {
  const [row] = await db()
    .select({ body: redditPosts.body })
    .from(redditPosts)
    .where(
      and(
        eq(redditPosts.id, postId),
        sql`exists (select 1 from ${candidateSources} where ${candidateSources.projectId} = ${projectId} and ${candidateSources.postId} = ${postId})`,
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const [[lead], [held]] = await Promise.all([
    db()
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.projectId, projectId), eq(leads.postId, postId), isNull(leads.commentId)))
      .limit(1),
    db()
      .select({ id: leadEvaluations.id })
      .from(leadEvaluations)
      .where(
        and(
          eq(leadEvaluations.projectId, projectId),
          eq(leadEvaluations.postId, postId),
          isNull(leadEvaluations.commentId),
          eq(leadEvaluations.decision, "review"),
        ),
      )
      .orderBy(desc(leadEvaluations.judgedAt))
      .limit(1),
  ]);
  const entry = lead ? `lead-${lead.id}` : held ? `held-${held.id}` : null;
  return { body: row.body, entry };
}
