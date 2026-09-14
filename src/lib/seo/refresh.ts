import { enqueueJob, writeProgress } from "@/jobs/enqueue";
import { clientForUser } from "@/lib/anyapi";
import { labelThreads } from "@/lib/discovery/label";
import {
  applyRelevance,
  loadEvidenceForPosts,
  UNLABELED,
  writeObservations,
} from "@/lib/discovery/store";
import type { FetchContext } from "@/lib/reddit/fetch";
import { fetchPost } from "@/lib/reddit/skus";
import type { StoredPost } from "@/lib/reddit/store";
import { loadScanProject, type ScanProject } from "@/lib/scan/project";
import { tierForUser } from "@/lib/tier";
import { competitorNamed } from "./competitors";
import { fetchRankingThreads, googleQuery } from "./fetch";
import { seoSettings } from "./limits";
import { writeOpportunities, type OpportunityRow } from "./opportunities";
import { NO_PHRASINGS_PROGRESS } from "./read";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SeoRefreshOutcome = {
  phrasings: number;
  threads: number;
  costUsd: number;
};

/**
 * Opens one ranking thread so the page can show its score, replies and age.
 * A thread Reddit will not hand back is skipped: the rest of the phrasing is
 * still worth showing.
 */
async function readThread(
  ctx: FetchContext,
  url: string,
  maxAgeMs: number,
): Promise<{ post: StoredPost | null; costUsd: number }> {
  try {
    const result = await fetchPost(ctx, url, maxAgeMs);
    return { post: result.value[0] ?? null, costUsd: result.costUsd };
  } catch {
    return { post: null, costUsd: 0 };
  }
}

async function refreshPhrasing(
  project: ScanProject,
  ctx: FetchContext,
  phrasing: string,
  maxAgeMs: number,
): Promise<{ threads: number; costUsd: number; seen: Seen[] }> {
  const ranked = await fetchRankingThreads(ctx, phrasing, maxAgeMs);
  let costUsd = ranked.costUsd;
  const rows: OpportunityRow[] = [];
  const seen: Seen[] = [];
  for (const result of ranked.value) {
    const thread = await readThread(ctx, result.url, maxAgeMs);
    costUsd += thread.costUsd;
    if (!thread.post) {
      continue;
    }
    rows.push({
      postId: thread.post.id,
      position: result.position,
      competitorPresent: competitorNamed(
        project.competitors,
        thread.post.title,
        thread.post.body,
      ),
    });
    seen.push({
      postId: thread.post.id,
      canonicalUrl: result.url,
      subreddit: thread.post.subreddit.toLowerCase(),
      query: googleQuery(phrasing),
      position: result.position,
      title: thread.post.title,
      snippet: result.snippet,
    });
  }
  await writeOpportunities(project.id, phrasing, rows);
  return { threads: rows.length, costUsd, seen };
}

/** One ranking thread, as discovery files what it has seen of a thread. */
type Seen = {
  postId: string;
  canonicalUrl: string;
  subreddit: string;
  query: string;
  position: number | null;
  title: string;
  snippet: string | null;
};

/**
 * Judges the ranking threads this project has no verdict on yet, against the
 * same product facts and with the same call discovery uses. Most of them need
 * no call at all: discovery and this refresh ask Google the one question, so a
 * phrasing discovery has already asked returns threads it has already judged.
 * What is left is a phrasing the discovery budget never reached, and one call
 * is what stops the page ordering those threads as if nobody had looked.
 *
 * Exported for its own test: the refresh around it needs a funded client and
 * two upstream calls, and what is worth pinning is which threads it pays to
 * judge.
 */
export async function judgeUnseen(project: ScanProject, seen: Seen[]): Promise<void> {
  if (seen.length === 0) {
    return;
  }
  const byPost = new Map(seen.map((thread) => [thread.postId, thread]));
  await writeObservations(
    project.id,
    [...byPost.values()].map((thread) => ({ ...thread, family: null, destination: null })),
  );
  const held = await loadEvidenceForPosts(project.id, [...byPost.keys()]);
  const judged = new Set(
    held.filter((row) => row.relevance !== UNLABELED).map((row) => row.postId),
  );
  const labels = await labelThreads({
    projectId: project.id,
    productText: project.productText,
    candidates: [...byPost.values()]
      .filter((thread) => !judged.has(thread.postId))
      .map((thread) => ({
        id: thread.postId,
        subreddit: thread.subreddit,
        title: thread.title,
        snippet: thread.snippet ?? "",
      })),
  });
  for (const label of labels) {
    await applyRelevance(project.id, label.id, label.relevance, label.destination);
  }
}

/**
 * One Reddit SEO refresh: for every problem phrasing the tier allows, which
 * Reddit threads Google ranks, what each thread looks like now, and whether a
 * competitor is named in it. It searches the way buyers say the problem, not
 * the plan's Reddit queries, because those are Boolean expressions Google
 * cannot read. Every project books its next refresh on the way out, at its tier's refresh
 * interval, including one with no phrasings yet: a project that booked nothing
 * would never look again once its owner wrote them.
 */
export async function runSeoRefresh(
  projectId: string,
  jobId: string,
): Promise<SeoRefreshOutcome> {
  const project = await loadScanProject(projectId);
  if (!project) {
    throw new Error("This project no longer exists");
  }
  const { limits } = await tierForUser(project.userId);
  const settings = seoSettings(limits, project.phrasings);
  const maxAgeMs = settings.refreshDays * DAY_MS;
  if (settings.phrasings.length === 0) {
    await writeProgress(jobId, NO_PHRASINGS_PROGRESS);
    await enqueueJob("seo_refresh", projectId, new Date(Date.now() + maxAgeMs));
    return { phrasings: 0, threads: 0, costUsd: 0 };
  }
  const funded = await clientForUser(project.userId);
  const ctx: FetchContext = { projectId, funded, maxAgeMs };

  let threads = 0;
  let costUsd = 0;
  const seen: Seen[] = [];
  for (const [index, phrasing] of settings.phrasings.entries()) {
    await writeProgress(
      jobId,
      `Searching ${index + 1} of ${settings.phrasings.length}: ${phrasing}`,
    );
    const done = await refreshPhrasing(project, ctx, phrasing, maxAgeMs);
    threads += done.threads;
    costUsd += done.costUsd;
    seen.push(...done.seen);
  }

  await writeProgress(jobId, "Reading who is asking in each thread");
  await judgeUnseen(project, seen);

  await writeProgress(jobId, "Finished");
  await enqueueJob("seo_refresh", projectId, new Date(Date.now() + maxAgeMs));
  return { phrasings: settings.phrasings.length, threads, costUsd };
}
