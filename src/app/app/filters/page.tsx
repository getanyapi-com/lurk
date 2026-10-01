import Link from "next/link";
import { LeadFiltersForm } from "@/components/product/LeadFiltersForm";
import { ScoringPanel } from "@/components/product/ScoringPanel";
import { requireLocalUser } from "@/lib/auth";
import { ALERT_SCORE_FLOOR, parseLeadFilters } from "@/lib/leadFilters";
import { wordsHidden } from "@/lib/leads";
import { listMutes } from "@/lib/mutes";
import { requireActiveProject } from "@/lib/projects";
import { DEFAULT_SCORE_THRESHOLD } from "@/lib/scan/constants";
import { scoringPreview } from "@/lib/scoring/apply";
import { parseScoring } from "@/lib/scoring/weights";
import { xEnabledFor } from "@/lib/x/enabled";

type FiltersPageProps = { searchParams: Promise<{ project?: string }> };

/**
 * Which of the judge's leads this project wants, and in what order: the
 * ranking weights and the filters. Apart from the Product page, which is what
 * the scorer is told about the product, since none of this changes a verdict.
 */
export default async function FiltersPage({ searchParams }: FiltersPageProps) {
  const user = await requireLocalUser();
  const project = await requireActiveProject(user.id, (await searchParams).project);


  const [preview, hidden, mutes] = await Promise.all([
    scoringPreview(project.id),
    wordsHidden(project.id),
    listMutes(project.id),
  ]);
  const filters = parseLeadFilters(project.leadFilters);

  // Both forms hold what was typed in them, so switching projects draws them afresh.
  return (
    <div key={project.id} className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          Filters
        </h1>
        <p className="text-body text-fg-muted">
          Which leads you see and get alerts for, and in what order. Nothing here
          is scanned or judged again; what the scorer is told about your product
          is under{" "}
          <Link href={`/app/product?project=${project.id}`} className="underline">
            Product
          </Link>
          .
        </p>
      </div>
      <LeadFiltersForm
        filters={{
          projectId: project.id,
          scoreThreshold: project.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD,
          alertMinScore: filters.alertMinScore,
          xMinScore: xEnabledFor(user.id) ? filters.xMinScore : undefined,
          mustMention: filters.mustMention,
          muted: mutes.filter((mute) => mute.kind === "keyword").map((mute) => mute.value),
          mutedSubreddits: mutes.filter((mute) => mute.kind === "subreddit").length,
          defaultAlertScore: ALERT_SCORE_FLOOR,
        }}
        hidden={hidden}
      />
      <ScoringPanel
        projectId={project.id}
        saved={parseScoring(project.scoring)}
        communities={preview.communities}
        leads={preview.leads}
      />
    </div>
  );
}
