import { eq } from "drizzle-orm";
import { enqueueJob, writeProgress } from "@/jobs/enqueue";
import { db } from "@/db";
import { projectCompetitors, projects } from "@/db/schema";
import { clientForUser } from "@/lib/anyapi";
import { productFacts, productText } from "@/lib/product";
import type { FetchContext } from "@/lib/reddit/fetch";
import { tierForUser } from "@/lib/tier";
import { labelThreads } from "./label";
import { expandDiscoveryQueries, type DiscoveryQuery } from "./queries";
import {
  competitorsFrom,
  coverageFrom,
  dedupeThreads,
  isDestinationQuery,
  mergeCompetitors,
  type CompetitorRank,
} from "./rank";
import { runDiscoveryQueries } from "./serp";
import {
  applyRelevance,
  loadEvidence,
  parseDestinations,
  parseTextList,
  UNLABELED,
} from "./store";
import { discoveryBudget, publishFromEvidence } from "./run";

/**
 * The weekly delta. Discovery does not run again from nothing: it buys a few
 * more queries where the evidence is thinnest, merges what they found into
 * what this project already holds, and republishes the plan from all of it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many queries one delta buys, from the plan Kevin accepted. */
export const DELTA_QUERIES = 4;

export type RefreshOutcome = { queries: number; threads: number; costUsd: number };

/** The queries this project has already asked, read back off its evidence. */
export function askedQueries(
  rows: { query: string; family: string | null }[],
  destinationNames: string[],
): DiscoveryQuery[] {
  const byQuery = new Map<string, DiscoveryQuery>();
  for (const row of rows) {
    const place = destinationNames.find((name) => isDestinationQuery(row.query, [name])) ?? null;
    byQuery.set(row.query, {
      query: row.query,
      family: row.family ?? "unnamed",
      destination: place,
      kind: place === null ? "problem" : "destination",
    });
  }
  return [...byQuery.values()];
}

/** The competitors already standing, so a delta adds to them. */
async function existingCompetitors(projectId: string): Promise<CompetitorRank[]> {
  const rows = await db()
    .select()
    .from(projectCompetitors)
    .where(eq(projectCompetitors.projectId, projectId));
  return rows
    .filter((row) => row.role === "direct_substitute")
    .map((row) => ({ name: row.name, role: "direct_substitute" as const, evidence: row.evidence }));
}

/**
 * One discovery_refresh job. It books its own next run on the way out, at the
 * tier's interval, so a project keeps learning without anyone pressing a
 * button, exactly as its scans do.
 */
export async function runDiscoveryRefresh(
  projectId: string,
  jobId: string,
): Promise<RefreshOutcome> {
  const rows = await db().select().from(projects).where(eq(projects.id, projectId));
  const project = rows[0];
  if (!project) {
    throw new Error("This project no longer exists");
  }
  const { limits } = await tierForUser(project.userId);
  const budget = discoveryBudget(limits);
  const maxAgeMs = budget.refreshDays * DAY_MS;
  const destinations = parseDestinations(project.destinations);
  const problemPhrasings = parseTextList(project.problemPhrasings);
  const evidence = await loadEvidence(projectId);
  const used = askedQueries(
    evidence,
    destinations.map((place) => place.name),
  );

  const queries = expandDiscoveryQueries({
    problemPhrasings,
    destinations,
    budget: budget.queries,
    used,
    coverage: coverageFrom(evidence),
    max: used.length + DELTA_QUERIES,
  });
  if (queries.length === 0) {
    await writeProgress(jobId, "Nothing new left to ask");
    await enqueueJob("discovery_refresh", projectId, new Date(Date.now() + maxAgeMs));
    return { queries: 0, threads: 0, costUsd: 0 };
  }

  await writeProgress(jobId, `Asking Google ${queries.length} more questions`);
  const funded = await clientForUser(project.userId);
  const ctx: FetchContext = { projectId, funded, maxAgeMs };
  const found = await runDiscoveryQueries(ctx, queries, maxAgeMs);
  const known = new Set(evidence.map((row) => row.postId));
  const fresh = dedupeThreads(found.observations.map((row) => ({ ...row, relevance: UNLABELED })))
    .filter((thread) => !known.has(thread.postId));

  const standing = await existingCompetitors(projectId);
  const facts = productFacts(
    project,
    standing.map((row) => row.name),
  );
  const labels = await labelThreads({
    projectId,
    product: facts,
    destinations: destinations.map((place) => place.name),
    candidates: fresh.map((thread) => ({
      id: thread.postId,
      subreddit: thread.subreddit,
      title: thread.title,
      snippet: thread.snippet,
    })),
  });
  for (const label of labels) {
    await applyRelevance(projectId, label.id, label.relevance, label.destination);
  }

  await writeProgress(jobId, "Republishing the plan");
  await publishFromEvidence({
    projectId,
    rows: await loadEvidence(projectId),
    destinations,
    limits,
    competitors: mergeCompetitors(standing, competitorsFrom(labels)),
    productTexts: [productText(facts), ...problemPhrasings],
    phrasings: problemPhrasings,
  });
  await enqueueJob("discovery_refresh", projectId, new Date(Date.now() + maxAgeMs));
  return { queries: queries.length, threads: fresh.length, costUsd: found.costUsd };
}
