import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectCompetitors, projectKeywords, projectSubreddits, projects } from "@/db/schema";
import { parseTextList } from "@/lib/discovery/store";
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
  productText: string;
};

function productText(row: typeof projects.$inferSelect, competitors: string[]): string {
  const capabilities = parseTextList(row.capabilities);
  const exclusions = parseTextList(row.exclusions);
  const notBuyers = parseTextList(row.notBuyers);
  return [
    `Product: ${row.name}`,
    row.url ? `Website: ${row.url}` : "",
    row.pain ? `Pain it solves: ${row.pain}` : "",
    row.solution ? `What it does: ${row.solution}` : "",
    row.targetUsers ? `Who buys it: ${row.targetUsers}` : "",
    capabilities.length > 0 ? `Can: ${capabilities.join("; ")}` : "",
    exclusions.length > 0 ? `Does not: ${exclusions.join("; ")}` : "",
    notBuyers.length > 0 ? `Not a buyer: ${notBuyers.join("; ")}` : "",
    row.geography ? `Sells in: ${row.geography}` : "",
    row.budgetFit ? `Budget: ${row.budgetFit}` : "",
    competitors.length > 0 ? `Competitors: ${competitors.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

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
  const queries: PlanRow[] = keywords.map((item) => ({
    id: item.id,
    table: "keyword",
    key: item.keyword,
    source: item.source,
    state: item.state,
    lastCoveredAt: item.lastCoveredAt,
    evidence: item.evidence ?? 0,
  }));
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
    productText: productText(row, competitorNames),
  };
}
