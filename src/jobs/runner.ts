import { and, asc, eq, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { enqueueOnce } from "./enqueue";
import { HEARTBEAT_MS, LEASE_MS } from "./lease";
import { handlerFor, nextRunAt, type Job } from "./registry";

/** No other unfinished job of this project may hold a live lease. */
function noSiblingRunning(leaseCutoff: Date) {
  return sql`not exists (
    select 1 from ${jobs} sibling
    where sibling.project_id = ${jobs.projectId}
      and sibling.finished_at is null
      and sibling.started_at is not null
      and sibling.started_at >= ${leaseCutoff.toISOString()}::timestamptz
  )`;
}

/**
 * The jobs somebody is watching: the setup of a project made a moment ago and
 * the sweep it books. Whoever signed up is looking at a board that says
 * "Starting", so these are claimed before anything routine and are not made to
 * wait for one of the routine workers to come free.
 */
export const WATCHED_KINDS = ["discovery_initial", "backfill"];

/**
 * Takes one due job, a watched one first. The scheduler asks for only one sort
 * when the other has no room left to run. The UPDATE ... RETURNING is the claim: a second worker
 * running the same statement sees a live lease and gets no row. A job whose
 * lease has expired is claimable again, which is how a crash recovers. The
 * sibling check is the per-project exclusion: two jobs of one project never run
 * at once, so an unlimited user cannot occupy every worker with one project.
 * Claims are issued one at a time by the scheduler, so the check cannot be read
 * by two workers before either of them has written its own lease.
 */
export async function claimNextJob(
  now = new Date(),
  only?: "watched" | "routine",
): Promise<Job | null> {
  const leaseCutoff = new Date(now.getTime() - LEASE_MS);
  const candidate = db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        isNull(jobs.finishedAt),
        lte(jobs.runAt, now),
        or(isNull(jobs.startedAt), lt(jobs.startedAt, leaseCutoff)),
        noSiblingRunning(leaseCutoff),
        only === "watched" ? inArray(jobs.kind, WATCHED_KINDS) : undefined,
        only === "routine" ? notInArray(jobs.kind, WATCHED_KINDS) : undefined,
      ),
    )
    .orderBy(sql`${inArray(jobs.kind, WATCHED_KINDS)} desc`, asc(jobs.runAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const claimed = await db()
    .update(jobs)
    .set({ startedAt: now, finishedAt: null, error: null })
    .where(inArray(jobs.id, candidate))
    .returning();
  return claimed[0] ?? null;
}

/** What a driver puts under its own error: the database's own complaint. */
type Cause = { message?: unknown; code?: unknown; detail?: unknown; cause?: unknown };

/**
 * A NUL character reaches here inside a driver's own complaint, because the
 * model output that failed the write is quoted back in it. Postgres refuses a
 * NUL in text too, so leaving one in would fail the write of the failure and
 * leave the job with no reason at all.
 */
function withoutNul(text: string): string {
  return text.replaceAll("\u0000", "");
}

/** One piece of an error, on one line, or nothing when there is no text. */
function line(value: unknown, label = ""): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text === "" ? null : `${label}${text}`;
}

/**
 * What a person reading the job should see: the message, never a stack. A
 * failed statement arrives wrapped, and the wrapper's message is the SQL it
 * tried, so every cause under it is kept too. Postgres names the rule that
 * rejected the write in the cause's own message, code and detail, and without
 * them a failed insert says only which table it was writing to.
 */
export function reasonFor(error: unknown): string {
  if (!(error instanceof Error)) {
    return withoutNul(String(error));
  }
  const parts = [line(error.message)];
  const seen = new Set<unknown>([error]);
  let cause: unknown = (error as Cause).cause;
  while (typeof cause === "object" && cause !== null && !seen.has(cause)) {
    seen.add(cause);
    const { message, code, detail } = cause as Cause;
    parts.push(line(message), line(code, "code "), line(detail, "detail "));
    cause = (cause as Cause).cause;
  }
  const said = new Set<string>();
  for (const part of parts) {
    if (part !== null) {
      said.add(part);
    }
  }
  return withoutNul([...said].join("; "));
}

/**
 * The lease this worker holds, which is the started_at stamp it last wrote.
 * Every write conditions on that stamp, so a worker whose lease was taken back
 * writes nothing: the reclaiming worker's own stamp no longer matches.
 */
type Lease = { stamp: Date | null };

function heldBy(job: Job, lease: Lease) {
  return and(
    eq(jobs.id, job.id),
    lease.stamp ? eq(jobs.startedAt, lease.stamp) : isNull(jobs.startedAt),
  );
}

/** Re-stamps the lease. False means another worker already took the job. */
async function renewLease(job: Job, lease: Lease, now = new Date()): Promise<boolean> {
  const renewed = await db()
    .update(jobs)
    .set({ startedAt: now })
    .where(heldBy(job, lease))
    .returning({ id: jobs.id });
  if (renewed.length === 0) {
    return false;
  }
  lease.stamp = now;
  return true;
}

/**
 * Keeps a running job's lease alive until it is stopped. A timer that stops
 * with the process is exactly the signal the queue wants: silence means the
 * worker is gone, and the job is claimable again after LEASE_MS.
 */
function startHeartbeat(job: Job): { lease: Lease; stop: () => void } {
  const lease: Lease = { stamp: job.startedAt };
  const timer = setInterval(() => {
    void renewLease(job, lease).then((held) => {
      if (!held) {
        clearInterval(timer);
      }
    });
  }, HEARTBEAT_MS);
  timer.unref?.();
  return { lease, stop: () => clearInterval(timer) };
}

/** Writes the end of the job, unless this worker no longer holds its lease. */
async function finish(job: Job, lease: Lease, error: string | null): Promise<boolean> {
  const written = await db()
    .update(jobs)
    .set({ finishedAt: new Date(), error })
    .where(heldBy(job, lease))
    .returning({ id: jobs.id });
  return written.length > 0;
}

/**
 * Puts a recurring kind back on the queue after it failed, so one transient
 * error cannot end a project's schedule. It only queues when nothing of that
 * kind is already waiting, so a scan the user asked for keeps its own time.
 */
async function requeueRecurring(job: Job): Promise<void> {
  const runAt = await nextRunAt(job);
  if (runAt) {
    await enqueueOnce(job.kind, runAt, job.projectId);
  }
}

/**
 * Runs one already claimed job to its end, failure included, holding its lease
 * open for as long as the handler runs. A job that lost its lease while it ran
 * writes no result and queues no successor: the worker that took it over owns
 * both, so one long scan can never be finished twice.
 */
export async function runClaimedJob(job: Job): Promise<void> {
  const { lease, stop } = startHeartbeat(job);
  try {
    const handler = handlerFor(job.kind);
    if (!handler) {
      throw new Error(`No handler registered for job kind ${job.kind}`);
    }
    await handler(job);
    await finish(job, lease, null);
  } catch (error) {
    if (await finish(job, lease, reasonFor(error))) {
      await requeueRecurring(job);
    }
  } finally {
    stop();
  }
}

/** Runs one due job if there is one. Returns whether it ran anything. */
export async function runDueJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) {
    return false;
  }
  await runClaimedJob(job);
  return true;
}
