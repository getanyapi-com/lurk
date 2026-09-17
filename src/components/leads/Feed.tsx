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
import { VerdictBadge } from "@/components/VerdictBadge";
import { buildStream, toCard } from "@/components/leads/stream";
import { entryHref, requestedEntry, selectEntry, type Selection } from "@/components/leads/workspace";
import {
  FEED_PAGE_SIZE,
  feedFilter,
  type FeedParams,
  type LeadStatus,
  type ReviewItem,
} from "@/lib/feed";
import { competitorsNamedIn } from "@/lib/competitors/read";
import { countLeads, feedFacets, findLead, listLeadFaces, listLeads, listReviewItems } from "@/lib/leads";
import { isBusy, projectActivity } from "@/lib/projectActivity";
import { scanReport, verdictSentence } from "@/lib/scan/report";

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
 */
export async function Feed({ projectId, params }: FeedProps) {
  const filter = feedFilter(params);
  const [rows, total, faces, facets, activity, review, report] = await Promise.all([
    listLeads(projectId, filter, { limit: FEED_PAGE_SIZE, offset: 0 }),
    countLeads(projectId, filter),
    listLeadFaces(projectId, filter),
    feedFacets(projectId),
    projectActivity(projectId),
    listReviewItems(projectId, filter.days),
    scanReport(projectId, filter.days),
  ]);
  const entries = buildStream(rows.map(toCard));
  const held = filter.status === "new" ? review : [];
  const selection = await openOn(projectId, entries, held, params.lead);
  const competitors =
    selection?.kind === "lead" && selection.entry.lead.postId
      ? await competitorsNamedIn(projectId, selection.entry.lead.postId)
      : [];
  const selectedId =
    selection === null ? null : selection.kind === "lead" ? selection.entry.id : params.lead ?? null;
  // One sentence, in one of two places: over the list when it has leads to
  // count, and inside it when it is empty and has to say why.
  const sentence = verdictSentence(report, total);
  /**
   * A window that holds nothing is not the same as a project that holds
   * nothing: the first sweep reaches back a year, so the leads it found are
   * usually outside the window the feed opens on. Counted only when there is
   * an empty feed to explain.
   */
  const elsewhere =
    total === 0 && filter.status === "new" && filter.days !== "all"
      ? await countLeads(projectId, { ...filter, days: "all" })
      : 0;

  return (
    // Its own column, so the status line sits tight under the project's name
    // while everything below it keeps the page's own spacing.
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {total > 0 ? <p className="text-small text-fg-muted">{sentence}</p> : null}
        <ScanStatus activity={activity} />
      </div>

      <ActivityPoll busy={isBusy(activity)} />
      <PeopleStrip faces={faces} />
      <FeedFilters facets={facets} />

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
                  total={total}
                  selectedId={selectedId}
                >
                  {entries.map((entry) => (
                    <LeadRow
                      key={entry.id}
                      id={entry.id}
                      href={entryHref(params, entry.id)}
                      selected={entry.id === selectedId}
                      title={entry.lead.title}
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
