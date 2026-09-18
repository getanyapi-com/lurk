import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { jobs, projects } from "@/db/schema";
import { writeProgress } from "@/jobs/enqueue";
import { buildProfile } from "@/lib/profile";
import { discoveryBudget, runDiscovery } from "@/lib/discovery/run";
import { parseDestinations, parseTextList } from "@/lib/discovery/store";
import { productFacts } from "@/lib/product";
import { smallSweep } from "@/lib/sweepScale";
import { cadenceFor } from "@/lib/settings";
import { tierForUser } from "@/lib/tier";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What the initial discovery did, for the caller and the tests. */
export type InitialDiscoveryOutcome = {
  /** False when the project was already set up, so nothing was queued again. */
  queuedChildren: boolean;
};

async function progress(jobId: string | undefined, text: string): Promise<void> {
  if (jobId) {
    await writeProgress(jobId, text);
  }
}

/**
 * The first jobs of a project's life, written in the same transaction as the
 * marker that says the project is set up. The backfill fills the leads feed
 * from a year of Reddit's own search; the recurring scan starts at its own next
 * scheduled time, because the backfill has just read everything it would find; the
 * discovery delta is the first weekly top-up. The Reddit SEO pass and the
 * competitor scan are not here: measured 2026-09-18 they were 9 cents of a
 * 30 cent signup, for two tabs most signups had not opened, so each is
 * queued the first time its tab is (src/lib/startOnOpen.ts).
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
    // A trial-size project gets its sweep and nothing that would go on spending
    // after it: no SEO pass, no competitor scan, no recurring scan.
    if (smallSweep()) {
      await tx.insert(jobs).values({ kind: "backfill", projectId, runAt: new Date(now) });
      return true;
    }
    await tx.insert(jobs).values([
      { kind: "backfill", projectId, runAt: new Date(now) },
      { kind: "scan", projectId, runAt: scanAt },
      { kind: "discovery_refresh", projectId, runAt: new Date(now + refreshDays * DAY_MS) },
    ]);
    return true;
  });
}

/**
 * Everything a new project needs after its own page has been read: ask Google
 * where and how its buyers ask, publish the plan that answer produces, then
 * queue the jobs that fill its first screens. No community's self-promotion
 * rule is read here: it is one person's call on one reply, no first screen
 * needs it, and while this job ran the sweep could not start. This is the whole of what used to
 * happen inside the request that created the project, which took minutes.
 */
export async function runInitialDiscovery(
  projectId: string,
  jobId?: string,
): Promise<InitialDiscoveryOutcome> {
  const read = async () => (await db().select().from(projects).where(eq(projects.id, projectId)))[0];
  let project = await read();
  if (!project) {
    throw new Error("This project no longer exists");
  }
  // A project made a moment ago is a URL and nothing else. Its page is read
  // here and not in the request that made it: the read is one model call of
  // about 25 seconds, and the person who asked is better off watching the
  // work start than a button that says it is thinking.
  if (!project.pain && project.url) {
    const host = URL.canParse(project.url) ? new URL(project.url).hostname.replace(/^www\./, "") : project.url;
    const built = await buildProfile(projectId, project.userId, project.url, {}, (step) =>
      step === "scrape"
        ? progress(jobId, `Opening ${host}`)
        : step === "profile"
          ? progress(jobId, "Reading the page: what you sell, and who buys it")
          : undefined,
    );
    project = (await read()) ?? project;
    await progress(
      jobId,
      `${project.name} · ${built.problemPhrasings.length} ways your buyers describe the problem`,
    );
  }
  const { limits, settings } = await tierForUser(project.userId);

  await runDiscovery({
    onProgress: (text) => progress(jobId, text),
    projectId,
    userId: project.userId,
    // No competitor is known before discovery has looked for one.
    facts: productFacts(project, []),
    destinations: parseDestinations(project.destinations),
    problemPhrasings: parseTextList(project.problemPhrasings),
    limits,
  });

  // The sweep needs the plan and nothing else, so it is booked the moment the
  // plan exists.
  await progress(jobId, "Starting the sweep of the past year");
  const queuedChildren = await markDiscoveredAndQueue(
    projectId,
    cadenceFor(settings.settings.cadence).nextRunAt(new Date()),
    discoveryBudget(limits).refreshDays,
  );
  return { queuedChildren };
}
