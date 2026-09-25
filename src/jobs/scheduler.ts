import { Cron } from "croner";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { jobs, projects } from "@/db/schema";
import { config } from "@/lib/config";
import { projectsWithStaleEvaluations } from "@/lib/scan/rescore";
import { projectsOwedSearches } from "@/lib/scan/widen";
import { enqueueOnce, lastRunJob } from "./enqueue";
import { WATCHED_KINDS, claimNextJob, runClaimedJob } from "./runner";

let started: Cron | null = null;

/** Jobs running right now, and whether a pump is already handing work out. */
let running = 0;
let watched = 0;
let pumping = false;

/**
 * Fills every free worker slot, claiming one job at a time. Serial claiming is
 * what makes the per-project exclusion in claimNextJob reliable: the next claim
 * always sees the lease the previous one wrote. A finishing job pumps again, so
 * a freed slot does not wait for the next tick.
 *
 * A watched job does not need a free slot. With every worker on a nightly scan
 * a signup would otherwise look at "Starting" until one of them finished, so
 * those run past the worker count, up to a ceiling of their own that stops a
 * burst of signups from starting every sweep at once.
 */
async function pump(workers: number, watchedWorkers: number): Promise<void> {
  if (pumping) {
    return;
  }
  pumping = true;
  try {
    for (;;) {
      const room = running < workers;
      const watchedRoom = watched < watchedWorkers;
      if (!room && !watchedRoom) {
        return;
      }
      const job = await claimNextJob(
        new Date(),
        room && watchedRoom ? undefined : room ? "routine" : "watched",
      );
      if (!job) {
        return;
      }
      const isWatched = WATCHED_KINDS.includes(job.kind);
      // A watched job counts against its own ceiling and leaves the routine
      // slots alone, whichever way it was claimed.
      if (isWatched) {
        watched += 1;
      } else {
        running += 1;
      }
      void runClaimedJob(job).finally(() => {
        if (isWatched) {
          watched -= 1;
        } else {
          running -= 1;
        }
        void pump(workers, watchedWorkers);
      });
    }
  } finally {
    pumping = false;
  }
}

/**
 * Queues the job a project is missing: the initial discovery for one that has
 * never had a plan, or every recurring job that has none waiting. A job whose process
 * died left no successor behind, so without this a project stops being scanned,
 * and stops learning where its buyers ask, until somebody presses a button. The
 * competitor scan and the SEO refresh are here for the same reason and one
 * more: a project made before either kind was queued on creation has never had
 * one at all, so boot is the only place it can pick them up. A project holding
 * verdicts an older scorer made gets one sweep to bring them up to date; once
 * it has run there is nothing stale left, so it is never queued again.
 */
export async function seedProjectScans(): Promise<void> {
  const rows = await db()
    .select({
      id: projects.id,
      discoveredAt: projects.discoveredAt,
      createdAt: projects.createdAt,
      url: projects.url,
      profileVersion: projects.profileVersion,
      briefProfileVersion: projects.briefProfileVersion,
    })
    .from(projects);
  const stale = await projectsWithStaleEvaluations();
  const reseeded = new Set(
    (
      await db()
        .selectDistinct({ projectId: jobs.projectId })
        .from(jobs)
        // A reseed that failed is still owed: the first one queued was claimed
        // by the revision on its way out, which had no handler for it.
        .where(and(eq(jobs.kind, "profile_reseed"), isNull(jobs.error)))
    ).map((row) => row.projectId),
  );
  const owedSearches = await projectsOwedSearches(new Date());
  for (const [index, projectId] of owedSearches.entries()) {
    try {
      await enqueueOnce("widen_searches", new Date(Date.now() + BRIEF_START_MS + index * WIDEN_GAP_MS), projectId);
    } catch (error) {
      if (!isMissingProject(error)) {
        throw error;
      }
    }
  }
  for (const row of rows) {
    try {
      await seedProject(row, stale.has(row.id), reseeded.has(row.id));
    } catch (error) {
      /** The project was deleted between the read above and its insert. Nothing to seed. */
      if (!isMissingProject(error)) {
        throw error;
      }
    }
  }
}

/** Postgres 23503: the row a job would point at is gone. Drizzle wraps it as the cause. */
function isMissingProject(error: unknown): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return (cause as { code?: string } | null)?.code === "23503";
}

/**
 * Profiles made before this were read from the homepage alone, by a prompt that
 * asked for a product's limits only where the page spelled them out. Each gets
 * one new reading, spread over a few hours so the scrapes and the rescores
 * behind them never crowd a signup's first sweep.
 */
const PROFILES_READ_WHOLE_SINCE = new Date("2026-09-20T00:00:00Z");
const RESEED_GAP_MS = 2 * 60 * 1000;
let reseedsQueued = 0;

/**
 * Briefs owed at boot start after the outgoing revision is gone, since a job it
 * claims for a kind it has no handler for fails, and follow each other a few
 * seconds apart: each reads a site and asks one long model call, and the
 * rescore it queues is the expensive part.
 */
const BRIEF_START_MS = 3 * 60 * 1000;
const BRIEF_GAP_MS = 5 * 1000;
let briefsQueued = 0;

/**
 * Projects owed searches (lib/scan/widen.ts) start with the briefs and follow
 * each other a minute apart, so a hundred of them spread over two hours of the
 * house's daily data and model caps rather than landing in one tick.
 */
const WIDEN_GAP_MS = 60 * 1000;

type SeedRow = {
  id: string;
  discoveredAt: Date | null;
  createdAt: Date;
  url: string | null;
  profileVersion: number;
  briefProfileVersion: number | null;
};

async function seedProject(row: SeedRow, stale: boolean, reseeded: boolean): Promise<void> {
  if (!row.discoveredAt) {
    /**
     * A project whose first discovery never finished has no plan at all, so
     * a scan, an SEO pass or a competitor scan would have nothing to read
     * and would spend a person's money proving it. The initial discovery
     * queues all of those itself once it has a plan.
     */
    await enqueueOnce("discovery_initial", new Date(), row.id);
    return;
  }
  await enqueueOnce("scan", new Date(), row.id);
  await enqueueOnce("discovery_refresh", new Date(), row.id);
  // These two start the first time somebody opens their tab (see
  // startOnOpen), so only a project that has had one is owed the next.
  for (const kind of ["competitor_scan", "seo_refresh"]) {
    if (await lastRunJob(kind, row.id)) {
      await enqueueOnce(kind, new Date(), row.id);
    }
  }
  // A project whose brief is behind its profile gets the brief first, and the
  // brief job queues the rescore, so its verdicts are judged once, with it.
  if (row.briefProfileVersion === null || row.briefProfileVersion < row.profileVersion) {
    await enqueueOnce("brief", new Date(Date.now() + BRIEF_START_MS + briefsQueued * BRIEF_GAP_MS), row.id);
    briefsQueued += 1;
  } else if (stale) {
    await enqueueOnce("rescore", new Date(), row.id);
  }
  if (row.url && row.createdAt < PROFILES_READ_WHOLE_SINCE && !reseeded) {
    await enqueueOnce("profile_reseed", new Date(Date.now() + reseedsQueued * RESEED_GAP_MS), row.id);
    reseedsQueued += 1;
  }
}

/**
 * The running scheduler's pump, kept on the process rather than the module:
 * Next bundles instrumentation apart from the routes, so a Server Action that
 * imported this file would find its own copy, which never started.
 */
const KICK = Symbol.for("lurk.scheduler.kick");
type Kickable = { [KICK]?: () => void };

/**
 * Hands out due jobs now rather than at the next tick. A job queued by a person
 * who is watching, such as a new project's discovery, otherwise sits for up to
 * a minute before anything reads it. It does nothing where no scheduler runs.
 */
export function kickScheduler(): void {
  (globalThis as Kickable)[KICK]?.();
}

/**
 * One tick a minute, handing due jobs to a bounded set of workers. Startup
 * queues the instance-wide jobs and any project schedule that went missing;
 * from then on each job queues its own next run, and the runner re-queues a
 * recurring one that failed.
 */
export function startScheduler(): Cron {
  if (!started) {
    const workers = config().SCHEDULER_WORKERS;
    const watchedWorkers = config().SCHEDULER_WATCHED_WORKERS;
    void enqueueOnce("retention");
    void enqueueOnce("digest");
    // After the outgoing revision is gone, which has no handler for it yet.
    void enqueueOnce("alert_invites", new Date(Date.now() + BRIEF_START_MS));
    if (config().SCHEDULER_SEED) {
      void seedProjectScans();
    }
    (globalThis as Kickable)[KICK] = () => void pump(workers, watchedWorkers);
    started = new Cron("* * * * *", async () => {
      await pump(workers, watchedWorkers);
    });
  }
  return started;
}
