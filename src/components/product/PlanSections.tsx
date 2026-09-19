import { eq, inArray } from "drizzle-orm";
import { EvidenceThreads } from "@/components/product/EvidenceThreads";
import { PlanEditor } from "@/components/product/PlanEditor";
import { db } from "@/db";
import {
  projectCompetitors,
  projectKeywords,
  projectSubreddits,
  subreddits as subredditRows,
} from "@/db/schema";
import { dedupeThreads } from "@/lib/discovery/rank";
import { loadEvidence } from "@/lib/discovery/store";
import { retrievalBudgets } from "@/lib/scan/constants";
import { byWorth, explorationPick, retrieved, type PlanRow, type PlanTable } from "@/lib/scan/coverage";
import { tierForUser } from "@/lib/tier";

type PlanSectionsProps = { projectId: string; userId: string };

type PlanSource = {
  source: string;
  state: string;
  evidence: number;
  freshCandidates: number;
  freshLeads: number;
  lastCoveredAt: Date | null;
};

/** Only the columns a plan row shows, whichever table the row came from. */
function planRow(row: PlanSource) {
  return {
    source: row.source,
    state: row.state,
    evidence: row.evidence,
    freshCandidates: row.freshCandidates,
    freshLeads: row.freshLeads,
    lastCoveredAt: row.lastCoveredAt,
  };
}

type StoredRow = PlanSource & { id: string };

/** A stored row as the scan's own ordering reads it. */
function scanRow(table: PlanTable, key: string, row: StoredRow): PlanRow {
  return {
    id: row.id,
    table,
    key,
    source: row.source,
    state: row.state,
    lastCoveredAt: row.lastCoveredAt,
    evidence: row.evidence,
  };
}

/**
 * The rows in the order a scan spends its calls on them, with the ones the
 * next scan will reach marked. It is the scan's own ranking, so the page
 * cannot promise a row a turn the scan would not give it.
 */
function inScanOrder<T extends StoredRow>(
  table: PlanTable,
  rows: T[],
  keyOf: (row: T) => string,
  slots: number,
  explorerId: string | null,
): (T & { next: boolean })[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const all = rows.map((row) => scanRow(table, keyOf(row), row));
  const ranked = byWorth(retrieved(all));
  const reserved = explorerId && byId.has(explorerId) ? 1 : 0;
  const next = new Set(ranked.slice(0, Math.max(slots - reserved, 0)).map((row) => row.id));
  if (reserved && explorerId) {
    next.add(explorerId);
  }
  const rest = all
    .filter((row) => !ranked.includes(row))
    .sort(
      (a, b) =>
        Number(a.state === "excluded") - Number(b.state === "excluded") || b.evidence - a.evidence,
    );
  return [...ranked, ...rest].map((row) => ({ ...byId.get(row.id)!, next: next.has(row.id) }));
}

/** The icon for each community in the plan, and no others. */
async function iconsFor(names: string[]): Promise<Record<string, string | null>> {
  if (names.length === 0) {
    return {};
  }
  const rows = await db()
    .select({ name: subredditRows.name, iconUrl: subredditRows.iconUrl })
    .from(subredditRows)
    .where(inArray(subredditRows.name, names));
  return Object.fromEntries(rows.map((row) => [row.name, row.iconUrl]));
}

/**
 * What discovery wrote: the searches, the communities, the competitors and the
 * threads that are the evidence for all three.
 *
 * It reads a great deal more than the profile form above it - every evidence
 * row this project holds - so it is its own component, and the form arrives
 * without waiting for it.
 */
export async function PlanSections({ projectId, userId }: PlanSectionsProps) {
  const [keywords, subs, competitors, { limits }, evidence] = await Promise.all([
    db().select().from(projectKeywords).where(eq(projectKeywords.projectId, projectId)),
    db().select().from(projectSubreddits).where(eq(projectSubreddits.projectId, projectId)),
    db().select().from(projectCompetitors).where(eq(projectCompetitors.projectId, projectId)),
    tierForUser(userId),
    loadEvidence(projectId),
  ]);
  const budgets = retrievalBudgets(limits);
  const explorer = explorationPick(
    keywords.map((row) => scanRow("keyword", row.keyword, row)),
    subs.map((row) => scanRow("community", row.name, row)),
  );
  const searches = inScanOrder("keyword", keywords, (row) => row.keyword, budgets.searches, explorer?.id ?? null);
  // A community is reached two ways, by a search scoped to it and by its own
  // listing; the wider of the two is how many the next scan touches.
  const communities = inScanOrder(
    "community",
    subs,
    (row) => row.name,
    Math.max(budgets.scoped, budgets.listings),
    explorer?.id ?? null,
  );
  const icons = await iconsFor(subs.map((row) => row.name));
  const threads = dedupeThreads(evidence)
    .sort((left, right) => right.weight - left.weight || left.bestPosition - right.bestPosition)
    .map((thread) => {
      const row = evidence.find((item) => item.postId === thread.postId);
      return {
        postId: thread.postId,
        canonicalUrl: row?.canonicalUrl ?? "",
        subreddit: thread.subreddit,
        title: thread.title,
        relevance: row?.relevance ?? "unlabeled",
      };
    });

  return (
    <>
      <section className="flex flex-col gap-3 rounded-card border bg-surface p-4 md:p-6">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          What a scan does
        </h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-body text-fg-muted">
          <li>
            Searches all of Reddit for up to {budgets.searches} of your searches. Most leads come
            from here.
          </li>
          <li>Reads the newest posts in your top {budgets.listings} communities.</li>
          <li>Scores what it found against your product and keeps the buyers as leads.</li>
        </ol>
        <p className="text-small text-fg-muted">
          We wrote these lists from what Google shows your buyers discussing. Use the switch to
          turn a row off or on, and the box under each list to add your own.
        </p>
      </section>
      <PlanEditor
        title="Searches"
        hint="What we type into Reddit search. Plain words work; the ones we wrote use AND and OR to catch more phrasings."
        placeholder="hotels that let 18 year olds check in"
        addLabel="Add a search"
        idleHint="Switch one on and scans start using it."
        kind="keyword"
        projectId={projectId}
        rows={searches.map((row) => ({ value: row.keyword, next: row.next, ...planRow(row) }))}
        limit={limits?.keywordsPerProject ?? null}
      />
      <PlanEditor
        title="Communities"
        hint="Subreddits where your buyers turned up. Your searches already reach every subreddit; these also get their newest posts read."
        placeholder="r/saas"
        addLabel="Add a community"
        idleHint="We found a relevant thread in each of these, but too few to read them every scan. Switch one on and it joins the others."
        kind="subreddit"
        projectId={projectId}
        rows={communities.map((row) => ({ value: row.name, next: row.next, ...planRow(row) }))}
        limit={limits?.subredditsPerProject ?? null}
        icons={icons}
      />
      <PlanEditor
        title="Competitors"
        hint="Products your buyers compare you with. Mentions of them show up under Competitors."
        placeholder="Acme"
        addLabel="Add a competitor"
        idleHint="Switch one on and we watch for it again."
        kind="competitor"
        projectId={projectId}
        rows={competitors.map((row) => ({ value: row.name, domain: row.domain, ...planRow(row) }))}
        limit={limits?.competitors ?? null}
      />
      <EvidenceThreads threads={threads} />
    </>
  );
}
