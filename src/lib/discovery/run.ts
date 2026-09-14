import { clientForUser } from "@/lib/anyapi";
import type { FetchContext } from "@/lib/reddit/fetch";
import { TIERS, type TierLimits } from "@/lib/tiers";
import { labelThreads, type ThreadLabel } from "./label";
import { numberTerms } from "./phrases";
import { planFromRanks, publishDiscoveryPlan } from "./plan";
import {
  buildDiscoveryQueries,
  expandDiscoveryQueries,
  expansionShouldStop,
  type Destination,
  type DiscoveryQuery,
} from "./queries";
import {
  competitorsFrom,
  coverageFrom,
  dedupeThreads,
  isDestinationQuery,
  mergeCompetitors,
  rankCommunities,
  rankFamilies,
  rankSide,
  type CompetitorRank,
} from "./rank";
import { runDiscoveryQueries } from "./serp";
import { applyRelevance, loadEvidence, UNLABELED, type EvidenceRow } from "./store";

/**
 * One whole discovery pass: ask Google where and how this product's buyers
 * ask, let the model label what came back, and publish the plan the scan will
 * spend on. Nothing in the plan exists without a thread behind it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The budgets discovery spends. A self-hosted instance gets connected values. */
export function discoveryBudget(limits: TierLimits | null) {
  return {
    queries: limits?.discoveryQueries ?? TIERS.connected.discoveryQueries,
    max: limits?.discoveryQueriesMax ?? TIERS.connected.discoveryQueriesMax,
    refreshDays: limits?.discoveryRefreshDays ?? TIERS.connected.discoveryRefreshDays,
    scoped: limits?.scopedSearchesPerScan ?? TIERS.connected.scopedSearchesPerScan,
  };
}

/** What the model judges relevance against: the product, in its own words. */
export type ProductFacts = {
  name: string;
  pain: string;
  solution: string;
  targetUsers: string;
  serviceGeography: string;
  budgetFit: string;
  capabilities: string[];
  exclusions: string[];
};

export function productBrief(facts: ProductFacts): string {
  return [
    `Product: ${facts.name}`,
    facts.pain ? `Problem it solves: ${facts.pain}` : "",
    facts.solution ? `What it does: ${facts.solution}` : "",
    facts.targetUsers ? `Who buys it: ${facts.targetUsers}` : "",
    facts.capabilities.length > 0 ? `It can: ${facts.capabilities.join("; ")}` : "",
    facts.exclusions.length > 0 ? `It cannot: ${facts.exclusions.join("; ")}` : "",
    facts.serviceGeography ? `Where it works: ${facts.serviceGeography}` : "",
    facts.budgetFit ? `Budget: ${facts.budgetFit}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type RoundOutcome = { labels: ThreadLabel[]; newRelevant: number; costUsd: number };

/**
 * One round: buy the queries, label the threads none of the earlier rounds had
 * seen, and file each verdict against every row that saw that thread.
 */
async function runRound(
  ctx: FetchContext,
  brief: string,
  queries: DiscoveryQuery[],
  maxAgeMs: number,
  labelled: Set<string>,
): Promise<RoundOutcome> {
  const { observations, costUsd } = await runDiscoveryQueries(ctx, queries, maxAgeMs);
  const seen = observations.map((row) => ({ ...row, relevance: UNLABELED }));
  const fresh = dedupeThreads(seen).filter((thread) => !labelled.has(thread.postId));
  const labels = await labelThreads({
    projectId: ctx.projectId,
    productText: brief,
    candidates: fresh.map((thread) => ({
      id: thread.postId,
      subreddit: thread.subreddit,
      title: thread.title,
      snippet: thread.snippet,
    })),
  });
  for (const label of labels) {
    labelled.add(label.id);
    await applyRelevance(ctx.projectId, label.id, label.relevance, label.destination);
  }
  return {
    labels,
    newRelevant: labels.filter((label) => label.relevance === "relevant").length,
    costUsd,
  };
}

export type PublishInput = {
  projectId: string;
  rows: EvidenceRow[];
  destinations: Destination[];
  limits: TierLimits | null;
  competitors: CompetitorRank[];
  /** Everything this product says about itself, which is where its numbers come from. */
  productTexts: string[];
  /** The product's own phrasings, which a family with no constraint searches for. */
  phrasings: string[];
};

/** Ranks everything this project has ever seen and publishes the new plan. */
export async function publishFromEvidence(input: PublishInput) {
  const names = input.destinations.map((place) => place.name);
  const communities = rankCommunities(input.rows, names);
  const families = rankFamilies(input.rows, names, input.phrasings);
  const scoped = rankSide(input.rows.filter((row) => isDestinationQuery(row.query, names)))
    .filter((item) => item.weighted > 0)
    .slice(0, discoveryBudget(input.limits).scoped)
    .map((item) => item.name);
  const plan = planFromRanks({
    communities,
    families,
    competitors: input.competitors,
    scopedCommunities: scoped,
    productNumbers: numberTerms(input.productTexts),
    limits: input.limits,
  });
  await publishDiscoveryPlan(input.projectId, plan);
  return plan;
}

export type DiscoveryInput = {
  projectId: string;
  userId: string;
  facts: ProductFacts;
  destinations: Destination[];
  problemPhrasings: string[];
  limits: TierLimits | null;
};

export type DiscoveryOutcome = {
  queries: number;
  threads: number;
  communities: number;
  keywords: number;
  costUsd: number;
};

/**
 * Discovery for a project that has just been read: the opening queries, then
 * an expansion for every family or place that produced nothing, stopping when
 * two rounds in a row stop paying for themselves or the tier's hard maximum is
 * reached. The plan is published once, from all the evidence, at the end.
 */
export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryOutcome> {
  const budget = discoveryBudget(input.limits);
  const maxAgeMs = budget.refreshDays * DAY_MS;
  const funded = await clientForUser(input.userId);
  const ctx: FetchContext = { projectId: input.projectId, funded, maxAgeMs };
  const brief = productBrief(input.facts);

  const used: DiscoveryQuery[] = [];
  const labelled = new Set<string>();
  const labels: ThreadLabel[] = [];
  const perRound: number[] = [];
  let costUsd = 0;
  let queries = buildDiscoveryQueries({
    problemPhrasings: input.problemPhrasings,
    destinations: input.destinations,
    budget: budget.queries,
  });
  // The opening set is the page's own size: one query per phrasing, plus the
  // places. What the tier bounds is how far past it expansion may go, which is
  // the distance between its two numbers.
  const opening = queries.length;
  const ceiling = opening + Math.max(budget.max - budget.queries, 0);

  while (queries.length > 0) {
    const round = await runRound(ctx, brief, queries, maxAgeMs, labelled);
    used.push(...queries);
    labels.push(...round.labels);
    costUsd += round.costUsd;
    if (used.length > opening) {
      perRound.push(round.newRelevant);
    }
    if (expansionShouldStop(perRound)) {
      break;
    }
    queries = expandDiscoveryQueries({
      problemPhrasings: input.problemPhrasings,
      destinations: input.destinations,
      budget: budget.queries,
      used,
      coverage: coverageFrom(await loadEvidence(input.projectId)),
      max: ceiling,
    });
  }

  const rows = await loadEvidence(input.projectId);
  const plan = await publishFromEvidence({
    projectId: input.projectId,
    rows,
    destinations: input.destinations,
    limits: input.limits,
    competitors: mergeCompetitors([], competitorsFrom(labels)),
    productTexts: [brief, ...input.problemPhrasings],
    phrasings: input.problemPhrasings,
  });
  return {
    queries: used.length,
    threads: dedupeThreads(rows).length,
    communities: plan.subreddits.filter((row) => row.state === "active").length,
    keywords: plan.keywords.length,
    costUsd,
  };
}
