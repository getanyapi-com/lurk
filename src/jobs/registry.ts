import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, projects } from "@/db/schema";
import { alertInvitesOn } from "@/lib/alerts/config";
import { sendAlertInvites } from "@/lib/alerts/invite";
import { CADENCE_MS } from "@/lib/alerts/select";
import { runDiscoveryRefresh } from "@/lib/discovery/refresh";
import { runInitialDiscovery } from "@/lib/discovery/initial";
import { briefFromPage, writeBrief } from "@/lib/brief";
import { readSite } from "@/lib/profile";
import { deleteExpiredPosts } from "@/lib/retention";
import { discoveryBudget } from "@/lib/discovery/run";
import { runCompetitorScan } from "@/lib/competitors/scan";
import { runBackfill } from "@/lib/scan/backfill";
import { loadScanProject } from "@/lib/scan/project";
import { runRescore } from "@/lib/scan/rescore";
import { runScan } from "@/lib/scan/run";
import { widenSearches } from "@/lib/scan/widen";
import { runSeoRefresh } from "@/lib/seo/refresh";
import { deleteExpiredXData } from "@/lib/x/retention";
import { cadenceFor } from "@/lib/settings/cadence";
import { PRESETS } from "@/lib/settings/presets";
import { settingsForUser } from "@/lib/settings/resolve";
import type { ScanCadence } from "@/lib/settings/types";
import { tierForUser } from "@/lib/tier";
import { runDigest } from "./digest";
import { runInsights } from "./insights";
import { enqueueOnce } from "./enqueue";

export type Job = typeof jobs.$inferSelect;
export type JobHandler = (job: Job) => Promise<void>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The handler for a kind that is about one project: a job queued without one
 * is a bug in whatever queued it, so it fails rather than doing nothing.
 */
function perProject(run: (projectId: string, jobId: string) => Promise<unknown>): JobHandler {
  return async (job) => {
    if (!job.projectId) {
      throw new Error(`A ${job.kind} job needs a project`);
    }
    await run(job.projectId, job.id);
  };
}

/** Every job kind the scheduler knows how to run. */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  scan: perProject(runScan),
  /**
   * The one-time year sweep a new project starts with. It queues nothing after
   * itself when it finishes: the scan keeps the feed fresh from then on. When
   * it fails (a model timeout took one live run down mid-triage) it is due
   * again one scan interval later, like a scan, and resumes from what it
   * already bought and judged.
   */
  backfill: perProject(runBackfill),
  /**
   * The one job a brand new project starts with. Creating a project reads the
   * product page and nothing else, so this is where the plan comes from: the
   * whole first discovery, the communities it names, and the first jobs of the
   * project's life. It queues them once, whatever else queues it.
   */
  discovery_initial: perProject(runInitialDiscovery),
  /**
   * One sweep over every verdict an older scorer made, queued at boot for a
   * project that holds any. It runs once and queues nothing after itself: when
   * it succeeds the project has no stale verdict left to find.
   */
  rescore: perProject(runRescore),
  /**
   * The brief for a project whose profile it was not written against: every
   * project made before briefs existed, queued at boot, and any whose profile
   * was edited since. The site is read again, because the brief may say what
   * the profile may not, and the verdicts are then judged again with it. An
   * unreadable site still gets a brief from the profile alone.
   */
  brief: perProject(async (projectId) => {
    const project = await loadScanProject(projectId);
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
  }),
  /**
   * The sweep's best searches for a project that has none, and one scan with
   * them. It runs once per project and is never held, so a project nobody
   * attends still gets the leads its invite is built from.
   */
  widen_searches: perProject(widenSearches),
  discovery_refresh: perProject(runDiscoveryRefresh),
  /** Groups a project's recent leads into pain themes. */
  insights: perProject(runInsights),
  /** One project's competitors, one pass. */
  competitor_scan: perProject(runCompetitorScan),
  /** Which Reddit threads Google ranks for this project. */
  seo_refresh: perProject(runSeoRefresh),
  digest: runDigest,
  /**
   * Asks people with leads and no alert channel, once each, whether they want
   * new leads by email. A few dozen a pass, hourly, so the asks stay inside the
   * email service's hourly allowance alongside the digests. Boot books the
   * first pass only while alertInvitesOn(), and a pass that finds it off books
   * no successor, so an instance with the invites off runs none at all.
   */
  alert_invites: async () => {
    if (!alertInvitesOn()) {
      return;
    }
    await sendAlertInvites();
    await enqueueOnce("alert_invites", new Date(Date.now() + CADENCE_MS.hourly));
  },
  retention: async () => {
    await deleteExpiredPosts();
    await deleteExpiredXData();
    await enqueueOnce("retention", new Date(Date.now() + DAY_MS));
  },
  /**
   * X leads (src/lib/x). The first scan is queued by a new project's setup or
   * by opening the X tab, and each scan books its own successor, so with
   * X_LEADS off nothing ever queues one; a job that is somehow queued anyway returns without writing
   * or booking anything (runXScan checks the switch for the project's owner).
   * The pipeline is loaded on first use, so nothing X imports is on the path
   * every Reddit job loads.
   */
  x_scan: perProject(async (projectId, jobId) => {
    const { runXScan } = await import("@/lib/x/run");
    await runXScan(projectId, jobId);
  }),
};

export function handlerFor(kind: string): JobHandler | null {
  return JOB_HANDLERS[kind] ?? null;
}

/** Who owns this project, or null once it is gone. */
async function ownerOf(projectId: string): Promise<string | null> {
  const rows = await db()
    .select({ userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId));
  return rows[0]?.userId ?? null;
}

/** How this project's scans are spaced, which its settings decide. */
async function scanCadenceFor(projectId: string): Promise<ScanCadence> {
  const userId = await ownerOf(projectId);
  const cadence = userId
    ? (await settingsForUser(userId)).settings.cadence
    : PRESETS.connected.cadence;
  return cadenceFor(cadence);
}

/** Days between this project's discovery deltas, which its tier decides. */
async function discoveryRefreshDaysFor(projectId: string): Promise<number> {
  const userId = await ownerOf(projectId);
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
  // A failed X scan is due again at the fastest X cadence, and carries on from
  // what it already bought and judged.
  if (job.kind === "x_scan") {
    return new Date(now + HOUR_MS);
  }
  if (job.kind === "digest" || job.kind === "alert_invites") {
    return new Date(now + CADENCE_MS.hourly);
  }
  return null;
}
