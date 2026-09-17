import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectCompetitors, projectKeywords, projectSubreddits, projects } from "@/db/schema";
import { capped } from "@/lib/tier";
import type { TierLimits } from "@/lib/tiers";
import type { CommunityRank, CompetitorRank, FamilyRank } from "./rank";
import { compileBooleanQuery, scopedBooleanQuery } from "./rank";

/**
 * The retrieval plan discovery publishes: the communities worth reading, the
 * searches worth running in them, and the products worth watching for. It is
 * written in one transaction, so a scan never reads half a plan, and it never
 * touches a row a person pinned, excluded or added by hand.
 */

export type PlannedSubreddit = { name: string; state: "active" | "candidate"; evidence: number };
export type PlannedKeyword = { keyword: string; evidence: number };
export type PlannedCompetitor = {
  name: string;
  role: string;
  evidence: number;
  domain: string | null;
};

export type DiscoveryPlan = {
  subreddits: PlannedSubreddit[];
  keywords: PlannedKeyword[];
  competitors: PlannedCompetitor[];
};

export type PlanInput = {
  communities: CommunityRank[];
  families: FamilyRank[];
  competitors: CompetitorRank[];
  /** The communities a place query found, which get their own scoped search. */
  scopedCommunities: string[];
  /** The numbers this product itself says, which is what makes one a constraint. */
  productNumbers: Set<string>;
  limits: TierLimits | null;
};

/**
 * What a community has to have produced before the scan spends a polling slot
 * on it: two relevant threads, or one relevant and two that might be. One
 * thread is real evidence and keeps the community on the list as a candidate,
 * but it is not yet a place this product's buyers are known to ask in.
 */
export const ACTIVE_EVIDENCE = 2;

/**
 * Two problem families can say the same demand in the end - "hotels under 21"
 * and "hotel check in age" compile to one search - and a project holds one row
 * per search. The search is kept once, carrying the evidence of the strongest
 * family behind it, in the order the strongest family put it.
 */
function dedupeKeywords(rows: PlannedKeyword[]): PlannedKeyword[] {
  const best = new Map<string, PlannedKeyword>();
  for (const row of rows) {
    const seen = best.get(row.keyword);
    best.set(row.keyword, {
      keyword: row.keyword,
      evidence: Math.max(seen?.evidence ?? 0, row.evidence),
    });
  }
  return [...best.values()];
}

/**
 * What the ranking means for the plan. A community with no relevant evidence
 * gets no row at all, which is the whole point of discovery: nothing reaches
 * the plan because a model once said the name.
 */
export function planFromRanks(input: PlanInput): DiscoveryPlan {
  const earned = input.communities.filter((item) => item.weighted > 0);
  const slots = input.limits?.subredditsPerProject ?? earned.length;
  let taken = 0;
  const subreddits: PlannedSubreddit[] = earned.map((item) => {
    const polls = item.weighted >= ACTIVE_EVIDENCE && taken < slots;
    taken += polls ? 1 : 0;
    return {
      name: item.name,
      state: polls ? "active" : "candidate",
      evidence: Math.round(item.weighted),
    };
  });

  // A family whose evidence carries no constraint compiles to nothing, because
  // a bare subject like "hotel" matches most of Reddit. Some demands have no
  // constraint to carry: a person shopping for a Reddit scraper asks for the
  // thing by its name. Measured 2026-09-13 on getanyapi.com, every family
  // compiled empty and the project got no searches at all. Such a family falls
  // back to the phrasing whose own query earned it its evidence, which is why
  // the ranking carries that phrasing rather than this reading it off the key.
  // Measured the same day, reddit.search on "reddit scraper api" returns people
  // asking for one, where "reddit AND scraper AND api" returns people selling
  // one: 17 of 25 asks against 4, because requiring every word favours the
  // person whose own tool is named by all of them.
  const families = input.families.filter((family) => family.phrases.length > 0);
  const broad = families.map((family) => ({
    keyword: compileBooleanQuery(family.phrases, input.productNumbers) || (family.asked ?? ""),
    evidence: Math.round(family.weighted),
  }));
  const top = broad.find((item) => item.keyword.length > 0);
  const scoped = top
    ? input.scopedCommunities.map((name) => ({
        keyword: scopedBooleanQuery(top.keyword, name),
        evidence: top.evidence,
      }))
    : [];
  const keywords = capped(
    dedupeKeywords([...broad, ...scoped].filter((item) => item.keyword.length > 0)),
    input.limits?.keywordsPerProject,
  );

  return {
    subreddits,
    keywords,
    competitors: capped(
      input.competitors.map((item) => ({
        name: item.name,
        role: item.role,
        evidence: item.evidence,
        domain: item.domain,
      })),
      input.limits?.competitors,
    ),
  };
}

/** A row a person decided about is theirs, and a rebuild leaves it alone. */
const PRESERVED_STATES = ["pinned", "excluded"];

type PlanTable = typeof projectKeywords | typeof projectSubreddits | typeof projectCompetitors;

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

async function preservedRows<T extends PlanTable>(
  tx: Tx,
  table: T,
  projectId: string,
): Promise<T["$inferSelect"][]> {
  const rows = await tx
    .select()
    .from(table as PlanTable)
    .where(
      and(
        eq(table.projectId, projectId),
        or(inArray(table.state, PRESERVED_STATES), eq(table.source, "user")),
      ),
    );
  return rows as T["$inferSelect"][];
}

/**
 * Replaces this project's plan with the one discovery just computed. Rows a
 * person pinned, excluded or typed in themselves survive untouched, and every
 * other row is replaced together, inside one transaction.
 */
export async function publishDiscoveryPlan(projectId: string, plan: DiscoveryPlan): Promise<void> {
  await db().transaction(async (tx) => {
    const keptKeywords = await preservedRows(tx, projectKeywords, projectId);
    const keptSubreddits = await preservedRows(tx, projectSubreddits, projectId);
    const keptCompetitors = await preservedRows(tx, projectCompetitors, projectId);

    const dropOthers = async (table: PlanTable, keptIds: string[]) => {
      await tx
        .delete(table)
        .where(
          keptIds.length > 0
            ? and(eq(table.projectId, projectId), notInArray(table.id, keptIds))
            : eq(table.projectId, projectId),
        );
    };
    await dropOthers(projectKeywords, keptKeywords.map((row) => row.id));
    await dropOthers(projectSubreddits, keptSubreddits.map((row) => row.id));
    await dropOthers(projectCompetitors, keptCompetitors.map((row) => row.id));

    const keptKeywordNames = new Set(keptKeywords.map((row) => row.keyword));
    const keywords = plan.keywords.filter((row) => !keptKeywordNames.has(row.keyword));
    if (keywords.length > 0) {
      await tx.insert(projectKeywords).values(
        keywords.map((row) => ({
          projectId,
          keyword: row.keyword,
          source: "serp",
          state: "active",
          evidence: row.evidence,
        })),
      );
    }

    const keptSubredditNames = new Set(keptSubreddits.map((row) => row.name));
    const subreddits = plan.subreddits.filter((row) => !keptSubredditNames.has(row.name));
    if (subreddits.length > 0) {
      await tx.insert(projectSubreddits).values(
        subreddits.map((row) => ({
          projectId,
          name: row.name,
          source: "serp",
          state: row.state,
          evidence: row.evidence,
        })),
      );
    }

    const keptCompetitorNames = new Set(keptCompetitors.map((row) => row.name));
    const competitors = plan.competitors.filter((row) => !keptCompetitorNames.has(row.name));
    if (competitors.length > 0) {
      await tx.insert(projectCompetitors).values(
        competitors.map((row) => ({
          projectId,
          name: row.name,
          domain: row.domain,
          role: row.role,
          source: "serp",
          state: "active",
          evidence: row.evidence,
        })),
      );
    }

    await tx
      .update(projects)
      .set({ discoveryVersion: sql`${projects.discoveryVersion} + 1` })
      .where(eq(projects.id, projectId));
  });
}
