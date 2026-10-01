import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { xEvaluations, xProjects, xRuns } from "@/db/schema";
import {
  FIRST_LOOK_GRACE_DAYS,
  FIRST_LOOK_HOURS,
  MAX_WINDOW_HOURS,
  PENDING_STAGES,
  QUIET_LOOKBACK_DAYS,
  QUIET_RECHECK_DAYS,
} from "./constants";

/**
 * Whether X is quiet for a product: lurk has read X for it and not one person
 * asked or posted anything worth a reply. On 2026-09-27 a week of searches
 * found nothing in 134 posts for a freelancers' invoice tool, a pilates-studio
 * system and a medical-tourism directory, while founder and developer tools
 * found a few a week. The first check reads the last month, so an empty first
 * check is enough to say so: a quiet product is told plainly on the day it
 * opens the tab, and checked weekly rather than spending a search a day on
 * silence. One ask or reply in the lookback ends it.
 *
 * Only a run that searched counts as watching: one stopped by a spent budget
 * or an empty wallet, or with no search due, is not evidence that X is quiet,
 * and the tab says why it stopped instead. A run whose lookups partly failed
 * still searched. Nor is X quiet while posts it found still wait for the
 * judge or the reply check: a first look that read more than a day could
 * judge is not a verdict yet. The days are counted inside the lookback, so a
 * project coming back after weeks away is watched afresh, and it must be
 * watched for most of a week before one short read after the gap is called
 * quiet; the copy's days and posts cover the same span.
 */

const DAY_MS = 24 * 3_600_000;

export type XQuiet = {
  quiet: boolean;
  /** Days of X the posts read cover: since the first searching run in the lookback, plus the month it read when that was the first look. */
  days: number;
  /** New posts those runs read. */
  posts: number;
  /** Runs that searched, ever. */
  runs: number;
};

type RunTotals = {
  runs: number;
  /** The first searching run inside the lookback. */
  first: Date | null;
  /** The project's first searching run, and whether each of its lanes read its window to the end. */
  firstEver: Date | null;
  firstEverFull: boolean;
  /** When X was turned on for the project: its first searching run near this is the month-long first look. */
  enabledAt: Date | null;
  posts: number;
  shown: number;
  /** Posts still waiting for the judge, a lookup or the reply check. */
  pending: number;
};

/** The rule, on the totals; exported for the tests. */
export function quietFrom(totals: RunTotals, now: Date): XQuiet {
  const watched = totals.first ? Math.floor((now.getTime() - totals.first.getTime()) / DAY_MS) : 0;
  const firstLookInside =
    totals.first !== null &&
    totals.firstEver !== null &&
    totals.enabledAt !== null &&
    totals.first.getTime() === totals.firstEver.getTime() &&
    totals.firstEver.getTime() - totals.enabledAt.getTime() <= FIRST_LOOK_GRACE_DAYS * DAY_MS;
  // The month counts only when every lane of the first look read to its start.
  const days = watched + (firstLookInside && totals.firstEverFull ? FIRST_LOOK_HOURS / 24 : 0);
  const longEnough = firstLookInside || watched + MAX_WINDOW_HOURS / 24 >= QUIET_RECHECK_DAYS;
  const quiet = totals.runs >= 1 && totals.first !== null && totals.shown === 0 && totals.pending === 0 && longEnough;
  return { quiet, days, posts: totals.posts, runs: totals.runs };
}

/** A finished run that searched and was not cut short by a budget, a cap or a wallet. */
export const searched = and(
  isNotNull(xRuns.finishedAt),
  gt(xRuns.lanesRun, 0),
  or(isNull(xRuns.partialReason), like(xRuns.partialReason, "%lookups failed%")),
);

/**
 * The rule, read for one project. `enabledAt` is the project's x_projects
 * time, which a caller holding that row passes in rather than have it read
 * again; left out, it is read here.
 */
export async function xQuiet(projectId: string, now = new Date(), enabledAt?: Date | null): Promise<XQuiet> {
  const lookback = new Date(now.getTime() - QUIET_LOOKBACK_DAYS * DAY_MS);
  const [[all], [firstRun], [recent], [found], [waiting], [state]] = await Promise.all([
    db()
      .select({ runs: sql<number>`count(*)::int` })
      .from(xRuns)
      .where(and(eq(xRuns.projectId, projectId), searched)),
    db()
      .select({ startedAt: xRuns.startedAt, fullPages: xRuns.fullPages })
      .from(xRuns)
      .where(and(eq(xRuns.projectId, projectId), searched))
      .orderBy(asc(xRuns.startedAt))
      .limit(1),
    db()
      .select({
        first: sql<Date | null>`min(${xRuns.startedAt})`,
        posts: sql<number>`coalesce(sum(${xRuns.postsNew}), 0)::int`,
      })
      .from(xRuns)
      .where(and(eq(xRuns.projectId, projectId), searched, gte(xRuns.startedAt, lookback))),
    // Anything shown ends it, whatever the run that found it was cut short by.
    db()
      .select({ shown: sql<number>`coalesce(sum(${xRuns.leads} + ${xRuns.replies}), 0)::int` })
      .from(xRuns)
      .where(and(eq(xRuns.projectId, projectId), isNotNull(xRuns.finishedAt), gte(xRuns.startedAt, lookback))),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(xEvaluations)
      .where(and(eq(xEvaluations.projectId, projectId), inArray(xEvaluations.stage, PENDING_STAGES))),
    enabledAt !== undefined
      ? [{ enabledAt }]
      : db().select({ enabledAt: xProjects.enabledAt }).from(xProjects).where(eq(xProjects.projectId, projectId)),
  ]);
  return quietFrom(
    {
      runs: all?.runs ?? 0,
      first: recent?.first ? new Date(recent.first) : null,
      firstEver: firstRun ? firstRun.startedAt : null,
      firstEverFull: (firstRun?.fullPages ?? 0) === 0,
      enabledAt: state?.enabledAt ?? null,
      posts: recent?.posts ?? 0,
      shown: found?.shown ?? 0,
      pending: waiting?.n ?? 0,
    },
    now,
  );
}
