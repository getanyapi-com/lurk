import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectCompetitors, projectKeywords, projectSubreddits, projects } from "@/db/schema";
import { withoutNegations } from "@/lib/discovery/rank";
import { parseDestinations, parseTextList } from "@/lib/discovery/store";
import { productFacts, productText, type ProductFacts } from "@/lib/product";
import { DEFAULT_SCORE_THRESHOLD } from "./constants";
import { retrieved, type PlanRow } from "./coverage";

export type ScanProject = {
  id: string;
  userId: string;
  name: string;
  threshold: number;
  /** The version of the product facts below; a verdict is only reusable for it. */
  profileVersion: number;
  /** Every query the plan holds, whatever its state, with its watermark. */
  queries: PlanRow[];
  /** Every community the plan holds, whatever its state, with its watermark. */
  communities: PlanRow[];
  /** The queries and communities being retrieved now, for callers that only
   * need the names: the SEO refresh and the competitor scan. */
  keywords: string[];
  subreddits: string[];
  /** How buyers say the problem, which is what the SEO refresh asks Google. */
  phrasings: string[];
  competitors: string[];
  /** The places the product page named, which discovery and the SEO refresh label threads against. */
  destinations: string[];
  /** The product facts every judgement is made against. */
  product: ProductFacts;
  /** The same facts as prose, for the calls that still read text. */
  productText: string;
};

/**
 * The competitors a scan is allowed to use. A competitor row carries the plan's
 * own state vocabulary but is not a plan row, so `retrieved` reads the states
 * off a stand-in rather than off the table itself.
 */
function retrievedNames(rows: { id: string; name: string; source: string; state: string }[]) {
  return retrieved(
    rows.map((row) => ({
      id: row.id,
      table: "keyword" as const,
      key: row.name,
      source: row.source,
      state: row.state,
      lastCoveredAt: null,
      evidence: 0,
    })),
  ).map((row) => row.key);
}

/** Everything one scan needs about a project, read once. */
export async function loadScanProject(projectId: string): Promise<ScanProject | null> {
  const rows = await db().select().from(projects).where(eq(projects.id, projectId));
  const row = rows[0];
  if (!row) {
    return null;
  }
  const [keywords, subs, competitors] = await Promise.all([
    db().select().from(projectKeywords).where(eq(projectKeywords.projectId, projectId)),
    db().select().from(projectSubreddits).where(eq(projectSubreddits.projectId, projectId)),
    db().select().from(projectCompetitors).where(eq(projectCompetitors.projectId, projectId)),
  ]);
  /**
   * A competitor a person excluded on the Product page is not one of ours, so
   * it is neither scanned nor named to the judge. Competitor rows carry the
   * plan's own state vocabulary, so `retrieved` decides this too.
   */
  const competitorNames = retrievedNames(competitors);
  // A keyword saved before the compiler dropped bare negations is searched
  // without them. One that was nothing else is not searched at all, and of
  // several that are now the same search, the row being retrieved with the
  // most evidence is the one that is.
  const cleaned: PlanRow[] = keywords.map((item) => ({
    id: item.id,
    table: "keyword",
    key: withoutNegations(item.keyword),
    source: item.source,
    state: item.state,
    lastCoveredAt: item.lastCoveredAt,
    evidence: item.evidence ?? 0,
  }));
  const live = (row: PlanRow) => (retrieved([row]).length > 0 ? 1 : 0);
  const kept = new Map<string, PlanRow>();
  for (const row of cleaned) {
    const held = kept.get(row.key);
    if (!held || live(row) > live(held) || (live(row) === live(held) && row.evidence > held.evidence)) {
      kept.set(row.key, row);
    }
  }
  const queries = cleaned.filter((row) => row.key !== "" && kept.get(row.key) === row);
  const communities: PlanRow[] = subs.map((item) => ({
    id: item.id,
    table: "community",
    key: item.name,
    source: item.source,
    state: item.state,
    lastCoveredAt: item.lastCoveredAt,
    evidence: item.evidence ?? 0,
  }));
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    threshold: row.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
    profileVersion: row.profileVersion,
    queries,
    communities,
    keywords: retrieved(queries).map((row) => row.key),
    subreddits: retrieved(communities).map((row) => row.key),
    competitors: competitorNames,
    phrasings: parseTextList(row.problemPhrasings),
    destinations: parseDestinations(row.destinations).map((place) => place.name),
    product: productFacts(row, competitorNames),
    productText: productText(productFacts(row, competitorNames)),
  };
}
