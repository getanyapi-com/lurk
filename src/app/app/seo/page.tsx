import { refreshSeoAction } from "@/app/app/seo/actions";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { KeywordSection } from "@/components/seo/KeywordSection";
import { NoPhrasings } from "@/components/seo/NoPhrasings";
import type { RankingThread } from "@/components/seo/OpportunityCard";
import { RefreshStatus } from "@/components/seo/RefreshStatus";
import { SeoFilters } from "@/components/seo/SeoFilters";
import { lastRunJob, nextQueuedJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { activeProject } from "@/lib/projects";
import {
  listOpportunities,
  NO_PHRASINGS_PROGRESS,
  seoFacets,
  verdictOf,
  type SeoRow,
} from "@/lib/seo/read";

type SeoPageProps = {
  searchParams: Promise<{
    project?: string;
    keyword?: string;
    subreddit?: string;
    competitor?: string;
  }>;
};

const EMPTY_SENTENCE =
  "A refresh asks Google which Reddit threads rank for each way your buyers say the problem, then opens every thread for its score, replies and age. At catalog prices the search is about $0.001 per phrasing, and each thread it opens is about $0.001 more.";

function toThread(row: SeoRow): RankingThread {
  return {
    id: row.id,
    position: row.position,
    competitorPresent: row.competitorPresent,
    verdict: verdictOf(row.verdictRank),
    title: row.title,
    url: row.url,
    subreddit: row.subreddit,
    subredditIconUrl: row.subredditIconUrl,
    score: row.score,
    numComments: row.numComments,
    createdAt: row.createdAt,
  };
}

function byPhrasing(rows: SeoRow[]): Map<string, RankingThread[]> {
  const grouped = new Map<string, RankingThread[]>();
  for (const row of rows) {
    const threads = grouped.get(row.keyword) ?? [];
    threads.push(toThread(row));
    grouped.set(row.keyword, threads);
  }
  return grouped;
}

export default async function SeoPage({ searchParams }: SeoPageProps) {
  const user = await requireLocalUser();
  const params = await searchParams;
  const project = await activeProject(user.id, params.project);
  if (!project) {
    return (
      <EmptyState
        title="Reddit SEO"
        sentence="Create a project first, then a refresh can find the Reddit threads ranking for the way your buyers say the problem."
      />
    );
  }

  const [rows, facets, last, next] = await Promise.all([
    listOpportunities(project.id, {
      keyword: params.keyword,
      subreddit: params.subreddit,
      competitor: params.competitor,
    }),
    seoFacets(project.id),
    lastRunJob("seo_refresh", project.id),
    nextQueuedJob("seo_refresh", project.id),
  ]);
  const nothingToLookUp = Boolean(last?.finishedAt) && last?.progress === NO_PHRASINGS_PROGRESS;
  const grouped = byPhrasing(rows);
  const phrasings = [...grouped.keys()];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2" style={{ fontWeight: 500 }}>
            Reddit SEO
          </h2>
          <RefreshStatus last={last} next={next} />
        </div>
        <form action={refreshSeoAction.bind(null, project.id)}>
          <Button type="submit" size="lg">
            Refresh now
          </Button>
        </form>
      </div>
      <SeoFilters facets={facets} />
      {phrasings.length === 0 ? (
        nothingToLookUp ? (
          <NoPhrasings projectId={project.id} />
        ) : (
          <EmptyState title="Nothing ranked yet" sentence={EMPTY_SENTENCE} />
        )
      ) : (
        <div className="flex flex-col gap-6">
          {phrasings.map((phrasing) => (
            <KeywordSection
              key={phrasing}
              keyword={phrasing}
              threads={grouped.get(phrasing) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
