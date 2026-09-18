import Link from "next/link";
import { ActivityPoll } from "@/components/ActivityPoll";
import { FeedFilters } from "@/components/leads/FeedFilters";
import { HeldSection } from "@/components/leads/HeldSection";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { LeadPages } from "@/components/leads/LeadPages";
import { LeadRow } from "@/components/leads/LeadRow";
import { OpeningProvider } from "@/components/leads/opening";
import { LeadWorkspace } from "@/components/leads/LeadWorkspace";
import { PeopleStrip } from "@/components/leads/PeopleStrip";
import { ScanStatus } from "@/components/leads/ScanStatus";
import { LiveSweep } from "@/components/sweep/LiveSweep";
import { VerdictBadge } from "@/components/VerdictBadge";
import { buildStream, rowExcerpt, toCard } from "@/components/leads/stream";
import { entryHref, requestedEntry, selectEntry, type Selection } from "@/components/leads/workspace";
import { feedFilter, type FeedParams, type LeadStatus, type ReviewItem } from "@/lib/feed";
import { competitorsNamedIn } from "@/lib/competitors/read";
import { feedPage } from "@/lib/feedPage";
import { findLead } from "@/lib/leads";
import { isBusy, projectActivity } from "@/lib/projectActivity";
import { verdictSentence } from "@/lib/scan/report";
import { sweepShown, sweepSnapshot } from "@/lib/sweep";

import type { StreamEntry } from "@/components/leads/stream";

export type { FeedParams };

type FeedProps = {
  projectId: string;
  params: FeedParams;
};

const EMPTY_SENTENCE: Record<LeadStatus, string> = {
  new: "Nothing new in this window. The next scan runs on your schedule, or press Scan now.",
  hidden: "You have not hidden any leads yet.",
  not_fit: "You have not marked any leads as a miss yet.",
  resolved: "No lead has said in its thread that the need is already met.",
};

/** The prefix a lead's entry id carries, so a held item can never be one. */
const LEAD_PREFIX = "lead-";

/** The same page over the whole of time, keeping every other filter pill. */
function allTimeHref(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value) {
      query.set(name, value);
    }
  }
  query.set("days", "all");
  // The slice a strip column picked goes with the window it narrowed.
  query.delete("at");
  return `?${query.toString()}`;
}

/** The filters the list is on, which is what the next page is asked for by. */
function feedSearch(params: FeedParams): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value && name !== "lead") {
      query.set(name, value);
    }
  }
  return query.toString();
}

/**
 * The thread the pane opens on. The list holds one page, so a lead the URL
 * names can be one the page does not have - the fortieth row, clicked after
 * scrolling - and that one is read on its own rather than falling back to the
 * best lead in the window.
 */
async function openOn(
  projectId: string,
  entries: StreamEntry[],
  held: ReviewItem[],
  requestedId?: string,
): Promise<Selection | null> {
  const onPage = requestedEntry(entries, held, requestedId);
  if (onPage) {
    return onPage;
  }
  if (requestedId?.startsWith(LEAD_PREFIX)) {
    const lead = await findLead(projectId, requestedId.slice(LEAD_PREFIX.length));
    if (lead) {
      return { kind: "lead", entry: buildStream([toCard(lead)])[0] };
    }
  }
  return selectEntry(entries, held);
}

/**
 * Everything on the leads page that has to be read before it can be drawn.
 *
 * It is its own component so the page above it can answer at once with the
 * project's name and its Scan now button, and let this arrive behind a
 * skeleton. It reads one page of leads and how many there are in all: a
 * project with a backfill behind it holds hundreds, and reading every one of
 * them was the whole of the wait before the feed appeared.
 *
 * Everything one set of filter pills decides is read through lib/feedPage,
 * which answers a project's repeat of the same filter from what it already
 * read, so selecting a lead - which changes only `?lead=` - reads nothing
 * again. The two things a selection does move are read here: what the project
 * is doing, because a running scan writes a progress line every few seconds
 * and ActivityPoll re-renders this to show it, and the thread the pane opens
 * on.
 */
export async function Feed({ projectId, params }: FeedProps) {
  const filter = feedFilter(params);
  const [page, activity] = await Promise.all([
    feedPage(projectId, filter),
    projectActivity(projectId),
  ]);
  const { total, faces, facets, elsewhere } = page;
  // The first sweep is drawn while it runs and for a moment after, so the
  // page a new project lands on shows the year being read rather than an
  // empty feed and one line of text.
  const sweep = sweepShown(activity) ? await sweepSnapshot(projectId) : null;
  const entries = buildStream(page.rows.map(toCard));
  const held = filter.status === "new" ? page.review : [];
  const selection = await openOn(projectId, entries, held, params.lead);
  const competitors =
    selection?.kind === "lead" && selection.entry.lead.postId
      ? await competitorsNamedIn(projectId, selection.entry.lead.postId)
      : [];
  const selectedId =
    selection === null ? null : selection.kind === "lead" ? selection.entry.id : params.lead ?? null;
  // One sentence, in one of two places: over the list when it has leads to
  // count, and inside it when it is empty and has to say why.
  const sentence = verdictSentence(page.report, total);

  return (
    // Its own column, so the status line sits tight under the project's name
    // while everything below it keeps the page's own spacing.
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {total > 0 ? <p className="text-small text-fg-muted">{sentence}</p> : null}
        <ScanStatus activity={activity} />
      </div>

      <ActivityPoll busy={isBusy(activity)} />
      {sweep ? <LiveSweep projectId={projectId} first={sweep} /> : null}
      <PeopleStrip faces={faces} days={filter.days} at={filter.at} params={params} />
      <FeedFilters facets={facets} at={filter.at} params={params} />

      <OpeningProvider serverSelectedId={selectedId}>
        <LeadWorkspace
          list={
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-surface px-3 py-2">
                <span className="text-mono tracking-wide text-fg-muted uppercase">Leads</span>
                <span className="text-mono tabular-nums text-fg-muted">{total}</span>
              </div>
              {total === 0 ? (
                <p className="text-small p-3 text-fg-muted">
                  {filter.status !== "new" ? (
                    EMPTY_SENTENCE[filter.status]
                  ) : elsewhere > 0 ? (
                    <>
                      Nothing in this window.{" "}
                      <Link className="underline" href={allTimeHref(params)}>
                        {elsewhere} {elsewhere === 1 ? "lead" : "leads"} in all time
                      </Link>
                      .
                    </>
                  ) : (
                    sentence
                  )}
                </p>
              ) : (
                // Keyed by the filters, so changing a pill starts the pages
                // again rather than keeping the rows the last one fetched.
                <LeadPages
                  key={feedSearch(params)}
                  projectId={projectId}
                  search={feedSearch(params)}
                  drawn={entries.length}
                  lastPostId={entries.at(-1)?.lead.postId ?? null}
                  total={total}
                  selectedId={selectedId}
                >
                  {entries.map((entry, index) => (
                    <LeadRow
                      key={entry.id}
                      id={entry.id}
                      href={entryHref(params, entry.id)}
                      selected={entry.id === selectedId}
                      title={entry.lead.title}
                      excerpt={rowExcerpt(entry.lead)}
                      nested={index > 0 && entries[index - 1].lead.postId === entry.lead.postId}
                      author={entry.lead.author}
                      avatarUrl={entry.lead.avatarUrl}
                      subreddit={entry.lead.subreddit}
                      subredditIconUrl={entry.lead.subredditIconUrl}
                      createdAt={entry.lead.createdAt}
                      trailing={<VerdictBadge fit={entry.lead.fit} intent={entry.lead.intent} />}
                    />
                  ))}
                </LeadPages>
              )}
              {held.length > 0 ? (
                <HeldSection items={held} params={params} selectedId={selectedId} />
              ) : null}
            </>
          }
          pane={
            selection ? (
              <LeadDetail selection={selection} projectId={projectId} competitors={competitors} />
            ) : null
          }
        />
      </OpeningProvider>
    </div>
  );
}
