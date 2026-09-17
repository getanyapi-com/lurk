import { refreshSeoAction } from "@/app/app/seo/actions";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { NoPhrasings } from "@/components/seo/NoPhrasings";
import { RefreshStatus } from "@/components/seo/RefreshStatus";
import { SeoFilters } from "@/components/seo/SeoFilters";
import { SplitView } from "@/components/seo/SplitView";
import { ThreadTable } from "@/components/seo/ThreadTable";
import { lastRunJob, nextQueuedJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { activeProject } from "@/lib/projects";
import {
  listOpportunities,
  NO_PHRASINGS_PROGRESS,
  seoFacets,
  toThread,
  watchedCompetitors,
} from "@/lib/seo/read";
import { scoreThreads } from "@/lib/seo/score";
import { orderThreads, seoOrder, seoView, worthReplying, type SeoOrder } from "@/lib/seo/views";

type SeoParams = {
  project?: string;
  keyword?: string;
  subreddit?: string;
  competitor?: string;
  closed?: string;
  view?: string;
  order?: string;
  /** The thread the list-and-thread view is showing. */
  thread?: string;
};

type SeoPageProps = { searchParams: Promise<SeoParams> };

const EMPTY_SENTENCE =
  "A refresh asks Google which Reddit threads rank for each way your buyers say the problem, then opens every thread for its score, replies and age. At catalog prices the search is about $0.001 per phrasing, and each thread it opens is about $0.001 more.";

/** The same URL with one parameter changed, so a column head or a row is a link. */
function linker(params: SeoParams) {
  return (changes: Partial<Record<string, string | undefined>>): string => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...changes })) {
      if (value) {
        next.set(key, value);
      }
    }
    return `?${next.toString()}`;
  };
}

/** What the whole tab holds, before any of it is read. */
function tally(phrasings: number, threads: number, strong: number): string {
  return [
    `${phrasings} ${phrasings === 1 ? "phrasing" : "phrasings"}`,
    `${threads} ranking ${threads === 1 ? "thread" : "threads"}`,
    strong > 0 ? `${strong} worth replying in` : "none worth replying in yet",
  ].join(" · ");
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

  const view = seoView(params.view);
  const order = seoOrder(params.order);
  const filter = {
    keyword: params.keyword,
    subreddit: params.subreddit,
    competitor: params.competitor,
    closed: params.closed,
  };
  const [rows, facets, last, next, competitors] = await Promise.all([
    listOpportunities(project.id, filter),
    seoFacets(project.id, filter),
    lastRunJob("seo_refresh", project.id),
    nextQueuedJob("seo_refresh", project.id),
    watchedCompetitors(project.id),
  ]);
  const nothingToLookUp = Boolean(last?.finishedAt) && last?.progress === NO_PHRASINGS_PROGRESS;
  // The order is decided here, over the rows in hand, because three of the four
  // orders fold a score the database does not hold. The read's own order is the
  // tiebreak underneath it.
  const threads = orderThreads(scoreThreads(rows.map(toThread)), order);
  const href = linker(params);
  const selected = threads.find((thread) => thread.id === params.thread) ?? threads[0] ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2" style={{ fontWeight: 500 }}>
            Reddit SEO
          </h2>
          <RefreshStatus last={last} next={next} />
          {threads.length > 0 ? (
            <p className="text-mono text-fg-muted">
              {tally(
                new Set(threads.map((thread) => thread.keyword)).size,
                threads.length,
                threads.filter(worthReplying).length,
              )}
            </p>
          ) : null}
        </div>
        <form action={refreshSeoAction.bind(null, project.id)}>
          <Button type="submit" size="lg">
            Refresh now
          </Button>
        </form>
      </div>
      <SeoFilters facets={facets} />
      {threads.length === 0 ? (
        nothingToLookUp ? (
          <NoPhrasings projectId={project.id} />
        ) : (
          <EmptyState title="Nothing ranked yet" sentence={EMPTY_SENTENCE} />
        )
      ) : view === "split" ? (
        <SplitView
          threads={threads}
          selected={selected}
          hrefFor={(id) => href({ thread: id })}
          competitors={competitors}
        />
      ) : (
        <ThreadTable
          threads={threads}
          order={order}
          hrefFor={(asked: SeoOrder) => href({ order: asked })}
          competitors={competitors}
        />
      )}
    </div>
  );
}
