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
      <PlanEditor
        title="Searches"
        hint="What we search Reddit for. Google evidence wrote these; pin one to keep it."
        placeholder="cold email deliverability"
        kind="keyword"
        projectId={projectId}
        rows={keywords.map((row) => ({ value: row.keyword, ...planRow(row) }))}
        limit={limits?.keywordsPerProject ?? null}
      />
      <PlanEditor
        title="Communities"
        hint="Where relevant threads were actually found. Waiting ones are next in line."
        placeholder="r/saas"
        kind="subreddit"
        projectId={projectId}
        rows={subs.map((row) => ({ value: row.name, ...planRow(row) }))}
        limit={limits?.subredditsPerProject ?? null}
        icons={icons}
      />
      <PlanEditor
        title="Competitors"
        hint="Named in the evidence as doing the same job for the same person."
        placeholder="Acme"
        kind="competitor"
        projectId={projectId}
        rows={competitors.map((row) => ({ value: row.name, ...planRow(row) }))}
        limit={limits?.competitors ?? null}
      />
      <EvidenceThreads threads={threads} />
    </>
  );
}
