import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { jobs, projects } from "@/db/schema";
import { writeProgress } from "@/jobs/enqueue";
import { resolveActiveSubreddits } from "@/lib/profile";
import { discoveryBudget, runDiscovery } from "@/lib/discovery/run";
import { parseDestinations, parseTextList } from "@/lib/discovery/store";
import { productFacts } from "@/lib/product";
import { cadenceFor } from "@/lib/settings";
import { tierForUser } from "@/lib/tier";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What the initial discovery did, for the caller and the tests. */
export type InitialDiscoveryOutcome = {
  /** False when the project was already set up, so nothing was queued again. */
  queuedChildren: boolean;
  subreddits: string[];
};

async function progress(jobId: string | undefined, text: string): Promise<void> {
  if (jobId) {
    await writeProgress(jobId, text);
  }
}

/**
 * The first jobs of a project's life, written in the same transaction as the
 * marker that says the project is set up. The backfill fills the leads feed
 * from a year of Reddit's own search, the Google pass fills the Reddit SEO tab
 * and the competitor scan fills its own; the recurring scan starts at its own next
 * scheduled time, because the backfill has just read everything it would find; the
 * discovery delta is the first weekly top-up.
 *
 * The marker is claimed with a conditional update, so a second run of this
 * handler - a rebuild, or a retry after a crash that already wrote the row -
 * queues none of them twice.
 */
async function markDiscoveredAndQueue(
  projectId: string,
  scanAt: Date,
  refreshDays: number,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const claimed = await tx
      .update(projects)
      .set({ discoveredAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.discoveredAt)))
      .returning({ id: projects.id });
    if (claimed.length === 0) {
      return false;
    }
    const now = Date.now();
    await tx.insert(jobs).values([
      { kind: "backfill", projectId, runAt: new Date(now) },
      { kind: "seo_refresh", projectId, runAt: new Date(now) },
      { kind: "competitor_scan", projectId, runAt: new Date(now) },
      { kind: "scan", projectId, runAt: scanAt },
      { kind: "discovery_refresh", projectId, runAt: new Date(now + refreshDays * DAY_MS) },
    ]);
    return true;
  });
}

/**
 * Everything a new project needs after its own page has been read: ask Google
 * where and how its buyers ask, publish the plan that answer produces, buy the
 * sidebar and self-promotion rule of every community that plan will read, then
 * queue the jobs that fill its first screens. This is the whole of what used to
 * happen inside the request that created the project, which took minutes.
 */
export async function runInitialDiscovery(
  projectId: string,
  jobId?: string,
): Promise<InitialDiscoveryOutcome> {
  const rows = await db().select().from(projects).where(eq(projects.id, projectId));
  const project = rows[0];
  if (!project) {
    throw new Error("This project no longer exists");
  }
  const { limits, settings } = await tierForUser(project.userId);

  await progress(jobId, "Asking Google where your buyers ask");
  await runDiscovery({
    projectId,
    userId: project.userId,
    // No competitor is known before discovery has looked for one.
    facts: productFacts(project, []),
    destinations: parseDestinations(project.destinations),
    problemPhrasings: parseTextList(project.problemPhrasings),
    limits,
  });

  // The sweep needs the plan and nothing else, so it is booked the moment the
  // plan exists. The sidebars only feed the self-promotion rule a lead's detail
  // shows, and reading them first kept a new project waiting 27 seconds on
  // 2026-09-17 for something no first screen needs.
  await progress(jobId, "Booking the first sweep of the past year");
  const queuedChildren = await markDiscoveredAndQueue(
    projectId,
    cadenceFor(settings.settings.cadence).nextRunAt(new Date()),
    discoveryBudget(limits).refreshDays,
  );

  await progress(jobId, "Reading the rules of the communities it found");
  const subreddits = await resolveActiveSubreddits(projectId, project.userId);
  return { queuedChildren, subreddits };
}
