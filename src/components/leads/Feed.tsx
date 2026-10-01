import Link from "next/link";
import { FeedFilters } from "@/components/leads/FeedFilters";
import { HeldSection } from "@/components/leads/HeldSection";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { LeadPages } from "@/components/leads/LeadPages";
import { LeadRow } from "@/components/leads/LeadRow";
import { OpeningProvider } from "@/components/leads/opening";
import { LeadWorkspace } from "@/components/leads/LeadWorkspace";
import { PeopleStrip } from "@/components/leads/PeopleStrip";
import { ScanStatus } from "@/components/leads/ScanStatus";
import { FirstSweep } from "@/components/leads/FirstSweep";
import { AlertsOffer } from "@/components/leads/AlertsOffer";
import { ListSkeleton, Skeleton } from "@/components/Skeleton";
import { VerdictBadge } from "@/components/VerdictBadge";
import { buildStream, rowExcerpt, toCard } from "@/components/leads/stream";
import { entryHref, requestedEntry, selectEntry, type Selection } from "@/components/leads/workspace";
import { chatAppConfigured } from "@/lib/alerts/config";
import { alertsOffer, offerPreview } from "@/lib/alerts/offer";
import type { LocalUser } from "@/lib/auth";
import { feedFilter, type FeedParams, type LeadStatus, type ReviewItem } from "@/lib/feed";
import { competitorsNamedIn } from "@/lib/competitors/read";
import { feedPage } from "@/lib/feedPage";
import { findLead } from "@/lib/leads";
import type { Project } from "@/lib/projects";
import { parseScoring } from "@/lib/scoring/weights";
import { isOnboarding, type ProjectActivity } from "@/lib/projectActivity";
import { verdictSentence } from "@/lib/scan/report";
import { sweepShown, sweepStatus } from "@/lib/sweep";

import type { StreamEntry } from "@/components/leads/stream";

export type { FeedParams };

/** What the page above has already read, handed down rather than read again. */
type FeedProps = {
  user: LocalUser;
  project: Project;
  activity: ProjectActivity;
  params: FeedParams;
};

const EMPTY_SENTENCE: Record<LeadStatus, string> = {
  new: "Nothing new in this window. The next scan runs on your schedule.",
  replied: "You have not marked a thread as replied yet.",
  hidden: "You have not hidden any leads yet.",
  not_fit: "You have not marked any leads as a miss yet.",
  resolved: "No lead has said in its thread that the need is already met.",
};

/**
 * The list of a project whose first leads are still being found: the rows they
 * will fill, and a line saying they are on their way. A new project spends
 * its first minute here, and "nothing new in this window" was the wrong thing
 * to tell someone who had just been promised leads.
 */
function ArrivingLeads() {
  return (
    <div className="flex flex-col">
      <p className="text-small border-b p-3 text-fg-muted">
        Your first leads appear here as soon as they are found, usually within a minute. You can stay
        on this page; it fills in by itself.
      </p>
      <ListSkeleton rows={5} bare fade={0.17} />
    </div>
  );
}

/** Where the first lead will open, so the half of the page it will fill is not blank until then. */
function ArrivingPane() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <p style={{ fontWeight: 500 }}>The best lead opens here</p>
      <ul className="text-small flex list-disc flex-col gap-1.5 pl-4 text-fg-muted">
        <li>The post, in full, and who wrote it.</li>
        <li>Why it matched your product, in one sentence.</li>
        <li>The community&rsquo;s rule on mentioning a product, before you reply.</li>
      </ul>
      <div className="flex flex-col gap-2 pt-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

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
 * again. The two things a selection does move are read on every render: what
 * the project is doing, which the page reads and hands down because a running
 * scan writes a progress line every few seconds and ActivityPoll re-renders
 * this to show it, and the thread the pane opens on.
 */
export async function Feed({ user, project, activity, params: asked }: FeedProps) {
  const projectId = project.id;
  const page = await feedPage(projectId, feedFilter(asked), !asked.days && !asked.at);
  // An empty window nobody picked opened on the whole of time (see feedPage),
  // and the pills and links say so.
  const params = page.widened ? { ...asked, days: "all" } : asked;
  const filter = feedFilter(params);
  const { total, faces, facets, elsewhere } = page;
  // The first sweep is reported while it runs and for a moment after, over the
  // feed it fills, so the page a new project lands on says what is being read
  // and draws each lead as it is judged.
  const shown = sweepShown(activity);
  // A project still being set up or swept has no leads yet because none have
  // been found yet, not because there are none: its empty list says so.
  const arriving = isOnboarding(activity) && filter.status === "new";
  const entries = buildStream(page.rows.map(toCard));
  const held = filter.status === "new" ? page.review : [];
  // While the first leads are found, the page asks once whether to send new
  // ones on: the person is already watching, and a project with no channel is
  // only seen when they come back to look.
  const [sweep, offered, selection] = await Promise.all([
    shown ? sweepStatus(projectId) : null,
    shown || arriving ? alertsOffer(user.id, projectId, user.email) : null,
    openOn(projectId, entries, held, params.lead),
  ]);
  // Read beside the sweep, so a sweep that turned out to be gone asks nothing.
  const offer = sweep || arriving ? offered : null;
  const [preview, competitors] = await Promise.all([
    offer?.state === "ask" ? offerPreview(projectId, project.name) : null,
    selection?.kind === "lead" && selection.entry.lead.postId
      ? competitorsNamedIn(projectId, selection.entry.lead.postId)
      : [],
  ]);
  const scoring = selection?.kind === "lead" ? parseScoring(project.scoring) : null;
  const selectedId =
    selection === null ? null : selection.kind === "lead" ? selection.entry.id : params.lead ?? null;
  // One sentence, in one of two places: over the list when it has leads to
  // count, and inside it when it is empty and has to say why.
  const sentence = verdictSentence(page.report, total);

  return (
    // Its own column, so the status line sits tight under the project's name
    // while everything below it keeps the page's own spacing.
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {total > 0 ? <p className="text-small text-fg-muted">{sentence}</p> : null}
        {/* The sweep's own line says what the project is doing while it is up. */}
        {sweep ? null : <ScanStatus activity={activity} />}
      </div>
      {sweep ? <FirstSweep projectId={projectId} first={sweep} /> : null}
      {offer ? (
        <AlertsOffer
          projectId={projectId}
          offer={offer}
          preview={preview}
          slackInstall={chatAppConfigured("slack")}
          discordInstall={chatAppConfigured("discord")}
        />
      ) : null}
      {/* The pills ride in the strip's top line, so the two cost one row between them. */}
      {arriving && total === 0 ? null : (
        <PeopleStrip
          faces={faces}
          days={filter.days}
          at={filter.at}
          params={params}
          filters={<FeedFilters facets={facets} at={filter.at} params={params} />}
        />
      )}

      <OpeningProvider serverSelectedId={selectedId}>
        <LeadWorkspace
          asked={Boolean(params.lead)}
          backHref={`?${feedSearch(params)}`}
          list={
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-surface px-3 py-2">
                <span className="text-mono tracking-wide text-fg-muted uppercase">Leads</span>
                <span className="text-mono tabular-nums text-fg-muted">{total}</span>
              </div>
              {total === 0 && arriving ? (
                <ArrivingLeads />
              ) : total === 0 ? (
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
              <LeadDetail selection={selection} projectId={projectId} competitors={competitors} scoring={scoring} />
            ) : arriving ? (
              <ArrivingPane />
            ) : null
          }
        />
      </OpeningProvider>
    </div>
  );
}
