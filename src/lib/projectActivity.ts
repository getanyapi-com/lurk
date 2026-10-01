import { cache } from "react";
import { and, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import type { JobRow } from "@/jobs/enqueue";
import { errorSentence, relativeAge, relativeUntil } from "@/lib/format";

/**
 * What one project is doing right now, read once and shown everywhere. The
 * three kinds here are the ones a person is waiting on: the setup that gives a
 * new project its plan, the first sweep of the past year, and the scan that
 * keeps the feed fresh. Anything else runs behind its own tab.
 */
export const ACTIVITY_KINDS = ["discovery_initial", "backfill", "scan"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One job a person is waiting on, and whether a worker has picked it up yet. */
export type ActiveJob = {
  kind: ActivityKind;
  running: boolean;
  progress: string | null;
};

/** What is read of one job: all a page needs to say what the job is doing. */
export type ActivityRow = Pick<JobRow, "kind" | "runAt" | "startedAt" | "finishedAt" | "progress" | "error">;

export type ProjectActivity = {
  /** Running, or queued and already due. Empty means nothing is happening. */
  active: ActiveJob[];
  /** The last one of these kinds that ended, whether it worked or failed. */
  last: ActivityRow | null;
  /** The next scan waiting for this project, however far away it is. */
  nextScan: ActivityRow | null;
};

function isKind(kind: string): kind is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(kind);
}

/**
 * A job counts as active when a worker holds it, or when it is queued and its
 * time has passed: the tick that will pick it up is a minute away at most, and
 * telling a person nothing is scheduled in that minute is the exact lie this
 * replaces. A recurring scan booked for tonight is not active.
 */
export function activityFrom(rows: ActivityRow[], now = new Date()): ProjectActivity {
  const mine = rows.filter((row) => isKind(row.kind));
  const active: ActiveJob[] = [];
  for (const kind of ACTIVITY_KINDS) {
    for (const row of mine) {
      const due = row.runAt.getTime() <= now.getTime();
      if (row.kind === kind && !row.finishedAt && (row.startedAt || due)) {
        active.push({ kind, running: Boolean(row.startedAt), progress: row.progress });
      }
    }
  }
  const finished = mine
    .filter((row) => row.finishedAt)
    .sort((left, right) => right.finishedAt!.getTime() - left.finishedAt!.getTime());
  const scans = rows
    .filter((row) => row.kind === "scan" && !row.startedAt && !row.finishedAt)
    .sort((left, right) => left.runAt.getTime() - right.runAt.getTime());
  return { active, last: finished[0] ?? null, nextScan: scans[0] ?? null };
}

const ACTIVITY_COLUMNS = {
  kind: jobs.kind,
  runAt: jobs.runAt,
  startedAt: jobs.startedAt,
  finishedAt: jobs.finishedAt,
  progress: jobs.progress,
  error: jobs.error,
};

/**
 * What this project is doing in the kinds a person waits on. Only what
 * activityFrom can use is read: every job not yet finished, and the last one
 * that did. A project that scans every few hours holds hundreds of finished
 * scans, and reading them all to keep one would be nearly the whole read.
 *
 * Read once per server render (see currentLocalUser), since the leads page
 * and the feed under it both draw it.
 */
export const projectActivity = cache(async (projectId: string): Promise<ProjectActivity> => {
  const these = and(eq(jobs.projectId, projectId), inArray(jobs.kind, [...ACTIVITY_KINDS]));
  const [open, ended] = await Promise.all([
    db().select(ACTIVITY_COLUMNS).from(jobs).where(and(these, isNull(jobs.finishedAt))),
    db()
      .select(ACTIVITY_COLUMNS)
      .from(jobs)
      .where(and(these, isNotNull(jobs.finishedAt)))
      .orderBy(desc(jobs.finishedAt))
      .limit(1),
  ]);
  return activityFrom([...open, ...ended]);
});

/**
 * Whether any job of this project is running or due, whatever its kind. The
 * pages a person waits on name three kinds; the rail's counts and the Reddit
 * SEO and Competitors tabs are filled by the others, which a new project books
 * the moment its plan exists and which finish minutes after the sweep.
 */
export async function hasWorkInFlight(projectId: string, now = new Date()): Promise<boolean> {
  const [row] = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), isNull(jobs.finishedAt), lte(jobs.runAt, now)))
    .limit(1);
  return row !== undefined;
}

/**
 * Whether a new project is still being set up or swept for the first time.
 * Scan now has nothing to add then: the sweep is already reading everything a
 * scan would, and pressing it only spends the allowance on the same threads.
 */
export function isOnboarding(activity: ProjectActivity): boolean {
  return activity.active.some((job) => job.kind === "discovery_initial" || job.kind === "backfill");
}

const WAITING: Record<ActivityKind, string> = {
  discovery_initial: "Setting your project up: this starts within a minute.",
  backfill: "The first sweep of the past year is queued.",
  scan: "A scan is due now.",
};

const WORKING: Record<ActivityKind, string> = {
  discovery_initial: "Setting your project up",
  backfill: "Reading the past year",
  scan: "Scanning now",
};

const FINISHED: Record<ActivityKind, string> = {
  discovery_initial: "Your project was set up",
  backfill: "The first sweep of the past year finished",
  scan: "Last scan finished",
};

const STOPPED: Record<ActivityKind, string> = {
  discovery_initial: "Setting your project up stopped",
  backfill: "The sweep of the past year stopped",
  scan: "Last scan stopped",
};

function activeSentence(job: ActiveJob): string {
  if (!job.running) {
    return WAITING[job.kind];
  }
  return job.progress ? `${WORKING[job.kind]}: ${job.progress}.` : `${WORKING[job.kind]}.`;
}

function lastSentence(job: ActivityRow | null): string | null {
  if (!job?.finishedAt || !isKind(job.kind)) {
    return null;
  }
  if (job.error) {
    return `${STOPPED[job.kind]}: ${errorSentence(job.error)}`;
  }
  return `${FINISHED[job.kind]} ${relativeAge(job.finishedAt)}.`;
}

function nextSentence(job: ActivityRow | null): string | null {
  if (!job) {
    return null;
  }
  const until = relativeUntil(job.runAt);
  return until === "now" ? "Next scan is due now." : `Next scan ${until}.`;
}

/**
 * One plain line about this project. While anything is happening it says what,
 * because that is the only thing a person waiting wants to know; when nothing
 * is, it says what last happened and when the next scan runs.
 */
export function activitySentence(activity: ProjectActivity): string {
  if (activity.active.length > 0) {
    return activity.active.map(activeSentence).join(" ");
  }
  const parts = [lastSentence(activity.last), nextSentence(activity.nextScan)];
  const said = parts.filter((part): part is string => part !== null);
  return said.length > 0 ? said.join(" ") : "No scan has run yet. Press Scan now.";
}
