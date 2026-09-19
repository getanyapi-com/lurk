import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import type { ProjectActivity } from "@/lib/projectActivity";
import { candidateSources, jobs, leadEvaluations, leads, llmUsage, redditPosts } from "@/db/schema";
import { newLeadCount } from "@/lib/leads";

/**
 * A project's first sweep as it is happening, for the board that draws it on
 * the leads page. The sweep reads a title first and scores only the posts
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

/** How long a sweep that has ended still has its board drawn, so its last state can be read. */
const SWEEP_LINGER_MS = 90 * 1000;

/** Whether the leads page draws the sweep: while it is queued or running, and just after. */
export function sweepShown(activity: ProjectActivity, now = new Date()): boolean {
  // The setup that comes before the sweep counts too: a new project lands on
  // this board, and it says what is being read until there are threads to draw.
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

const ANSWERS_PER_ITEM: Record<string, number> = { triage: 2, score: 5 };

/**
 * A chunk's titles are read and the ones that pass are scored within a few
 * seconds, so a found post still without a verdict after this long was set
 * aside on its title. Until the sweep ends that is the only way to tell.
 */
const SCORING_LAG_MS = 6000;

const SCORED_SHOWN = 160;
const ASIDE_SHOWN = 120;
const BODY_CHARS = 220;

const EMPTY: SweepCounts = { found: 0, triaged: 0, scored: 0, asideAtTitle: 0, buyers: 0, review: 0, leads: 0 };

function decisionOf(value: string): SweepVerdict["decision"] {
  return value === "qualify" || value === "review" ? value : "reject";
}

/** The first sweep this project has queued, running or ended, as it stands now. */
export async function sweepSnapshot(projectId: string): Promise<SweepSnapshot | null> {
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
    return {
      state: "waiting",
      progress: setup?.progress ?? null,
      elapsedMs: 0,
      counts: EMPTY,
      answers: 0,
      costUsd: 0,
      threads: [],
      feedLeads: 0,
    };
  }
  const start = job.startedAt;
  const done = Boolean(job.finishedAt);
  const settledBefore = done ? new Date() : new Date(Date.now() - SCORING_LAG_MS);
  const post = {
    id: redditPosts.id,
    title: redditPosts.title,
    subreddit: redditPosts.subreddit,
    author: redditPosts.author,
    url: redditPosts.url,
    body: sql<string | null>`left(${redditPosts.body}, ${BODY_CHARS})`,
    ups: redditPosts.score,
    comments: redditPosts.numComments,
    createdAt: redditPosts.createdAt,
  };
  const [usage, [found], [tally], scored, aside] = await Promise.all([
    db()
      .select({
        purpose: llmUsage.purpose,
        items: sql<number>`coalesce(sum(${llmUsage.itemsAsked}), 0)::int`,
        usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float`,
      })
      .from(llmUsage)
      .where(
        and(
          eq(llmUsage.projectId, projectId),
          inArray(llmUsage.purpose, Object.keys(ANSWERS_PER_ITEM)),
          gte(llmUsage.at, start),
        ),
      )
      .groupBy(llmUsage.purpose),
    db()
      .select({ n: sql<number>`count(distinct ${candidateSources.postId})::int` })
      .from(candidateSources)
      .where(and(eq(candidateSources.projectId, projectId), gte(candidateSources.firstSeenAt, start))),
    db()
      .select({
        scored: sql<number>`count(*)::int`,
        buyers: sql<number>`count(*) filter (where ${leadEvaluations.relationship} = 'buyer')::int`,
        review: sql<number>`count(*) filter (where ${leadEvaluations.decision} = 'review')::int`,
        leads: sql<number>`count(*) filter (where ${leadEvaluations.decision} = 'qualify')::int`,
      })
      .from(leadEvaluations)
      .where(
        and(
          eq(leadEvaluations.projectId, projectId),
          sql`${leadEvaluations.commentId} is null`,
          gte(leadEvaluations.judgedAt, start),
        ),
      ),
    db()
      .select({
        ...post,
        decision: leadEvaluations.decision,
        score: leadEvaluations.score,
        relationship: leadEvaluations.relationship,
        needState: leadEvaluations.needState,
        fit: leadEvaluations.fit,
        intent: leadEvaluations.intent,
        quote: leadEvaluations.evidenceQuote,
      })
      .from(leadEvaluations)
      .innerJoin(redditPosts, eq(redditPosts.id, leadEvaluations.postId))
      .where(
        and(
          eq(leadEvaluations.projectId, projectId),
          sql`${leadEvaluations.commentId} is null`,
          gte(leadEvaluations.judgedAt, start),
        ),
      )
      .orderBy(desc(leadEvaluations.judgedAt))
      .limit(SCORED_SHOWN),
    db()
      .select(post)
      .from(candidateSources)
      .innerJoin(redditPosts, eq(redditPosts.id, candidateSources.postId))
      .where(
        and(
          eq(candidateSources.projectId, projectId),
          gte(candidateSources.firstSeenAt, start),
          lt(candidateSources.firstSeenAt, settledBefore),
          sql`not exists (select 1 from ${leadEvaluations} where ${leadEvaluations.projectId} = ${projectId} and ${leadEvaluations.postId} = ${candidateSources.postId} and ${leadEvaluations.commentId} is null)`,
        ),
      )
      .groupBy(redditPosts.id)
      .orderBy(desc(sql`min(${candidateSources.firstSeenAt})`))
      .limit(ASIDE_SHOWN),
  ]);

  const items = (purpose: string) => usage.find((row) => row.purpose === purpose)?.items ?? 0;
  const triaged = Math.min(items("triage"), found.n);
  // Titles that passed, by whichever of the two records is further along.
  const passed = Math.max(items("score"), tally.scored);
  const threads: SweepThread[] = [
    ...scored.map((row) => ({
      id: row.id,
      title: row.title,
      subreddit: row.subreddit,
      author: row.author,
      url: row.url,
      body: row.body,
      ups: row.ups,
      comments: row.comments,
      createdAt: row.createdAt.toISOString(),
      verdict: {
        decision: decisionOf(row.decision),
        score: row.score,
        relationship: row.relationship,
        needState: row.needState,
        fit: row.fit,
        intent: row.intent,
        quote: row.quote,
      },
    })),
    ...aside.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), verdict: null })),
  ];
  return {
    state: job.error ? "stopped" : done ? "done" : "running",
    progress: job.progress,
    elapsedMs: (job.finishedAt ?? new Date()).getTime() - start.getTime(),
    counts: {
      found: found.n,
      triaged,
      scored: tally.scored,
      asideAtTitle: done ? Math.max(0, found.n - tally.scored) : Math.max(0, triaged - passed),
      buyers: tally.buyers,
      review: tally.review,
      leads: tally.leads,
    },
    answers: usage.reduce((sum, row) => sum + row.items * (ANSWERS_PER_ITEM[row.purpose] ?? 0), 0),
    costUsd: usage.reduce((sum, row) => sum + row.usd, 0),
    threads,
    feedLeads: await newLeadCount(projectId),
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
