import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, projects } from "@/db/schema";
import { sendAlertInvites } from "@/lib/alerts/invite";
import { CADENCE_MS } from "@/lib/alerts/select";
import { config } from "@/lib/config";
import { runDiscoveryRefresh } from "@/lib/discovery/refresh";
import { runInitialDiscovery } from "@/lib/discovery/initial";
import { parseTextList } from "@/lib/discovery/store";
import { briefFromPage, writeBrief } from "@/lib/brief";
import { readSite, reseedFromPage } from "@/lib/profile";
import { deleteExpiredPosts } from "@/lib/retention";
import { discoveryBudget } from "@/lib/discovery/run";
import { runBackfill } from "@/lib/scan/backfill";
import { loadScanProject } from "@/lib/scan/project";
import { runRescore } from "@/lib/scan/rescore";
import { runScan } from "@/lib/scan/run";
import { widenSearches } from "@/lib/scan/widen";
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

/** Every job kind the scheduler knows how to run. */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  noop: async () => {},
  scan: async (job) => {
    if (!job.projectId) {
      throw new Error("A scan job needs a project");
    }
    await runScan(job.projectId, job.id);
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
    await runBackfill(job.projectId, job.id);
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
  /**
   * One new reading of the site for a project whose profile an older prompt
   * made, queued at boot and never again. When a fact changed, every verdict
   * the project holds was made about a different product, so they are judged
   * again; the text is already here, so that buys no Reddit data.
   */
  profile_reseed: async (job) => {
    if (!job.projectId) {
      throw new Error("A profile reseed needs a project");
    }
    const [project] = await db().select().from(projects).where(eq(projects.id, job.projectId));
    if (!project?.url) {
      return;
    }
    const result = await reseedFromPage({
      id: project.id,
      userId: project.userId,
      url: project.url,
      problemPhrasings: parseTextList(project.problemPhrasings),
      exclusions: parseTextList(project.exclusions),
      notBuyers: parseTextList(project.notBuyers),
      profileVersion: project.profileVersion,
    });
    if (result.refreshed || result.exclusions.length > 0 || result.notBuyers.length > 0) {
      await enqueueOnce("rescore", new Date(), project.id);
    }
    // Searches for a platform's API that the product never sold are in the plan
    // itself, and only a new plan takes them out.
    if (result.droppedPhrasings.length > 0) {
      await enqueueOnce("discovery_initial", new Date(), project.id);
    }
  },
  /**
   * The brief for a project whose profile it was not written against: every
   * project made before briefs existed, queued at boot, and any whose profile
   * was edited since. The site is read again, because the brief may say what
   * the profile may not, and the verdicts are then judged again with it. An
   * unreadable site still gets a brief from the profile alone.
   */
  brief: async (job) => {
    if (!job.projectId) {
      throw new Error("A brief needs a project");
    }
    const project = await loadScanProject(job.projectId);
    if (!project) {
      return;
    }
    const page = project.product.url
      ? await readSite(project.id, project.userId, project.product.url).catch(() => null)
      : null;
    const brief = await briefFromPage(
      project.id,
      { url: project.product.url ?? "", markdown: page?.markdown ?? null },
      { ...project.product, brief: undefined },
    );
    await writeBrief(project.id, brief, project.profileVersion);
    await enqueueOnce("rescore", new Date(), project.id);
  },
  /**
   * The sweep's best searches for a project that has none, and one scan with
   * them. It runs once per project and is never held, so a project nobody
   * attends still gets the leads its invite is built from.
   */
  widen_searches: async (job) => {
    if (!job.projectId) {
      throw new Error("Widening searches needs a project");
    }
    await widenSearches(job.projectId, job.id);
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
  /**
   * Asks people with leads and no alert channel, once each, whether they want
   * new leads by email. A few dozen a pass, hourly, so the asks stay inside the
   * email service's hourly allowance alongside the digests. Nothing goes out
   * until ALERT_INVITES is on; the pass keeps checking hourly until then.
   */
  alert_invites: async () => {
    if (config().ALERT_INVITES) {
      await sendAlertInvites();
    }
    await enqueueOnce("alert_invites", new Date(Date.now() + CADENCE_MS.hourly));
  },
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
  if (job.kind === "digest" || job.kind === "alert_invites") {
    return new Date(now + CADENCE_MS.hourly);
  }
  return null;
}
