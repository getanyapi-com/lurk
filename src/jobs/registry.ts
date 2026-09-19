import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, projects } from "@/db/schema";
import { CADENCE_MS } from "@/lib/alerts/select";
import { runDiscoveryRefresh } from "@/lib/discovery/refresh";
import { runInitialDiscovery } from "@/lib/discovery/initial";
import { deleteExpiredPosts } from "@/lib/retention";
import { discoveryBudget } from "@/lib/discovery/run";
import { runBackfill } from "@/lib/scan/backfill";
import { runRescore } from "@/lib/scan/rescore";
import { runScan } from "@/lib/scan/run";
import type { ScanCadence } from "@/lib/settings";
import { cadenceFor, PRESETS, settingsForUser } from "@/lib/settings";
import { tierForUser } from "@/lib/tier";
import { runCompetitorsJob } from "./competitors";
import { runDigest } from "./digest";
import { runInsightsJob } from "./insights";
import { enqueueOnce } from "./enqueue";
import { runSeoRefreshJob } from "./seo";

export type Job = typeof jobs.$inferSelect;
export type JobHandler = (job: Job) => Promise<void>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Books the themes job when a run wrote leads. Nothing else queues insights, so
 * without this a project's themes only ever change when somebody presses the
 * button on the insights page. enqueueOnce, not enqueueJob, so a grouping a
 * user just asked for keeps the time it was given.
 */
async function regroupLeads(projectId: string, leads: number): Promise<void> {
  if (leads > 0) {
    await enqueueOnce("insights", new Date(), projectId);
  }
}

/** Every job kind the scheduler knows how to run. */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  noop: async () => {},
  scan: async (job) => {
    if (!job.projectId) {
      throw new Error("A scan job needs a project");
    }
    const outcome = await runScan(job.projectId, job.id);
    await regroupLeads(job.projectId, outcome.leads);
  },
  /**
   * The one-time year sweep a new project starts with. It queues nothing after
   * itself when it finishes: the scan keeps the feed fresh from then on. When
   * it fails (a model timeout took one live run down mid-triage) it is due
   * again one scan interval later, like a scan, and resumes from what it
   * already bought and judged.
   */
  backfill: async (job) => {
    if (!job.projectId) {
      throw new Error("A backfill needs a project");
    }
    const outcome = await runBackfill(job.projectId, job.id);
    await regroupLeads(job.projectId, outcome.leads);
  },
  /**
   * The one job a brand new project starts with. Creating a project reads the
   * product page and nothing else, so this is where the plan comes from: the
   * whole first discovery, the communities it names, and the first jobs of the
   * project's life. It queues them once, whatever else queues it.
   */
  discovery_initial: async (job) => {
    if (!job.projectId) {
      throw new Error("An initial discovery needs a project");
    }
    await runInitialDiscovery(job.projectId, job.id);
  },
  /**
   * One sweep over every verdict an older scorer made, queued at boot for a
   * project that holds any. It runs once and queues nothing after itself: when
   * it succeeds the project has no stale verdict left to find.
   */
  rescore: async (job) => {
    if (!job.projectId) {
      throw new Error("A rescore needs a project");
    }
    await runRescore(job.projectId, job.id);
  },
  discovery_refresh: async (job) => {
    if (!job.projectId) {
      throw new Error("A discovery refresh needs a project");
    }
    await runDiscoveryRefresh(job.projectId, job.id);
  },
  insights: runInsightsJob,
  competitor_scan: runCompetitorsJob,
  seo_refresh: runSeoRefreshJob,
  digest: runDigest,
  retention: async () => {
    await deleteExpiredPosts();
    await enqueueOnce("retention", new Date(Date.now() + DAY_MS));
  },
};

export function handlerFor(kind: string): JobHandler | null {
  return JOB_HANDLERS[kind] ?? null;
}

/** How this project's scans are spaced, which its settings decide. */
async function scanCadenceFor(projectId: string): Promise<ScanCadence> {
  const rows = await db()
    .select({ userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId));
  const userId = rows[0]?.userId;
  const cadence = userId
    ? (await settingsForUser(userId)).settings.cadence
    : PRESETS.connected.cadence;
  return cadenceFor(cadence);
}

/** Days between this project's discovery deltas, which its tier decides. */
async function discoveryRefreshDaysFor(projectId: string): Promise<number> {
  const rows = await db()
    .select({ userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId));
  const userId = rows[0]?.userId;
  return discoveryBudget(userId ? (await tierForUser(userId)).limits : null).refreshDays;
}

/**
 * When a recurring kind is due again, or null when the kind runs once on
 * request. This repo has no retry policy, so a failed job simply waits its own
 * cadence: a scan or a competitor scan retries one scan interval later,
 * retention and an SEO refresh a day later, digest an hour later. That bounds retries at one attempt per cadence and
 * never runs a recurring job sooner than it would have run anyway.
 */
export async function nextRunAt(job: Job): Promise<Date | null> {
  const now = Date.now();
  const scanCadence =
    job.kind === "scan" ||
    job.kind === "backfill" ||
    job.kind === "discovery_initial" ||
    job.kind === "competitor_scan";
  if (scanCadence && job.projectId) {
    return (await scanCadenceFor(job.projectId)).nextRunAt(new Date(now));
  }
  if (job.kind === "discovery_refresh" && job.projectId) {
    return new Date(now + (await discoveryRefreshDaysFor(job.projectId)) * DAY_MS);
  }
  // An SEO refresh books its successor days out and only when it succeeds, so
  // a failed one looks again tomorrow rather than never.
  if (job.kind === "retention" || (job.kind === "seo_refresh" && job.projectId)) {
    return new Date(now + DAY_MS);
  }
  if (job.kind === "digest") {
    return new Date(now + CADENCE_MS.hourly);
  }
  return null;
}
