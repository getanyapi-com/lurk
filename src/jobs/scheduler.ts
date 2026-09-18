import { Cron } from "croner";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { config } from "@/lib/config";
import { projectsWithStaleEvaluations } from "@/lib/scan/rescore";
import { enqueueOnce } from "./enqueue";
import { claimNextJob, runClaimedJob } from "./runner";

let started: Cron | null = null;

/** Jobs running right now, and whether a pump is already handing work out. */
let running = 0;
let pumping = false;

/**
 * Fills every free worker slot, claiming one job at a time. Serial claiming is
 * what makes the per-project exclusion in claimNextJob reliable: the next claim
 * always sees the lease the previous one wrote. A finishing job pumps again, so
 * a freed slot does not wait for the next tick.
 */
async function pump(workers: number): Promise<void> {
  if (pumping) {
    return;
  }
  pumping = true;
  try {
    while (running < workers) {
      const job = await claimNextJob();
      if (!job) {
        return;
      }
      running += 1;
      void runClaimedJob(job).finally(() => {
        running -= 1;
        void pump(workers);
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
    .select({ id: projects.id, discoveredAt: projects.discoveredAt })
    .from(projects);
  const stale = await projectsWithStaleEvaluations();
  for (const row of rows) {
    try {
      await seedProject(row, stale.has(row.id));
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

async function seedProject(row: { id: string; discoveredAt: Date | null }, stale: boolean): Promise<void> {
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
  await enqueueOnce("competitor_scan", new Date(), row.id);
  await enqueueOnce("seo_refresh", new Date(), row.id);
  if (stale) {
    await enqueueOnce("rescore", new Date(), row.id);
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
 * queues the two instance-wide jobs and any project schedule that went missing;
 * from then on each job queues its own next run, and the runner re-queues a
 * recurring one that failed.
 */
export function startScheduler(): Cron {
  if (!started) {
    const workers = config().SCHEDULER_WORKERS;
    void enqueueOnce("retention");
    void enqueueOnce("digest");
    if (config().SCHEDULER_SEED) {
      void seedProjectScans();
    }
    (globalThis as Kickable)[KICK] = () => void pump(workers);
    started = new Cron("* * * * *", async () => {
      await pump(workers);
    });
  }
  return started;
}
