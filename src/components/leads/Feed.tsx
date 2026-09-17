import Link from "next/link";
import { ActivityPoll } from "@/components/ActivityPoll";
import { FeedFilters } from "@/components/leads/FeedFilters";
import { HeldSection } from "@/components/leads/HeldSection";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { LeadRow } from "@/components/leads/LeadRow";
import { OpeningProvider } from "@/components/leads/opening";
import { LeadWorkspace } from "@/components/leads/LeadWorkspace";
import { PeopleStrip } from "@/components/leads/PeopleStrip";
import { ScanStatus } from "@/components/leads/ScanStatus";
import { VerdictBadge } from "@/components/VerdictBadge";
import { buildStream, type CardLead } from "@/components/leads/stream";
import { entryHref, selectEntry } from "@/components/leads/workspace";
import type { FeedWindow, LeadStatus } from "@/lib/feed";
import { feedFacets, listLeads, listReviewItems } from "@/lib/leads";
import { isBusy, projectActivity } from "@/lib/projectActivity";
import { scanReport, verdictSentence } from "@/lib/scan/report";

export type FeedParams = {
  project?: string;
  status?: string;
  days?: string;
  subreddit?: string;
  stage?: string;
  theme?: string;
  lead?: string;
};

type FeedProps = {
  projectId: string;
  status: LeadStatus;
  days: FeedWindow;
  params: FeedParams;
};

const EMPTY_SENTENCE: Record<LeadStatus, string> = {
  new: "Nothing new in this window. The next scan runs on your schedule, or press Scan now.",
  hidden: "You have not hidden any leads yet.",
  not_fit: "You have not marked any leads as a miss yet.",
  resolved: "No lead has said in its thread that the need is already met.",
};

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

function toCard(lead: Awaited<ReturnType<typeof listLeads>>[number]): CardLead {
  const isComment = lead.commentId !== null;
  return {
    id: lead.id,
    score: lead.score,
    fit: lead.fit,
    intent: lead.intent,
    engagement: lead.engagement,
    stage: lead.stage,
    kind: lead.kind,
    reason: lead.reason,
    matchedPhrase: lead.matchedPhrase,
    title: lead.title,
    url: (isComment ? lead.commentPermalink : lead.url) ?? lead.url,
    subreddit: lead.subreddit,
    subredditIconUrl: lead.subredditIconUrl,
    subredditWeeklyActive: lead.subredditWeeklyActive,
    promoPolicy: lead.promoPolicy,
    rulesText: lead.rulesText,
    imageUrl: isComment ? null : lead.imageUrl,
    numComments: lead.numComments,
    points: isComment ? lead.commentScore : lead.postScore,
    createdAt: (isComment ? lead.commentCreatedAt : lead.createdAt) ?? lead.createdAt,
    body: (isComment ? lead.commentBody : lead.body) ?? "",
    author: isComment ? lead.commentAuthor : lead.postAuthor,
    avatarUrl: lead.authorAvatar,
    authorKarma: lead.authorKarma,
    authorCreatedAt: lead.authorCreatedAt,
    isComment,
    postAuthor: lead.postAuthor,
    postAuthorAvatar: lead.postAuthorAvatar,
  };
}

/**
 * Everything on the leads page that has to be read before it can be drawn.
 *
 * It is its own component so the page above it can answer at once with the
 * project's name and its Scan now button, and let this arrive behind a
 * skeleton. Against a real project the reads below take about nine tenths of
 * the second the whole page used to take, and nothing else on the page was
 * waiting on anything.
 */
export async function Feed({ projectId, status, days, params }: FeedProps) {
  const [rows, facets, activity, review, report] = await Promise.all([
    listLeads(projectId, {
      status,
      days,
      subreddit: params.subreddit,
      stage: params.stage,
      theme: params.theme,
    }),
    feedFacets(projectId),
    projectActivity(projectId),
    listReviewItems(projectId, days),
    scanReport(projectId, days),
  ]);
  const entries = buildStream(rows.map(toCard));
  const held = status === "new" ? review : [];
  const selection = selectEntry(entries, held, params.lead);
  const selectedId =
    selection === null ? null : selection.kind === "lead" ? selection.entry.id : params.lead ?? null;
  // One sentence, in one of two places: over the list when it has leads to
  // count, and inside it when it is empty and has to say why.
  const sentence = verdictSentence(report, entries.length);
  /**
   * A window that holds nothing is not the same as a project that holds
   * nothing: the first sweep reaches back a year, so the leads it found are
   * usually outside the window the feed opens on. Counted only when there is
   * an empty feed to explain.
   */
  const elsewhere =
    entries.length === 0 && status === "new" && days !== "all"
      ? buildStream(
          (await listLeads(projectId, {
            status,
            days: "all",
            subreddit: params.subreddit,
            stage: params.stage,
            theme: params.theme,
          })).map(toCard),
        ).length
      : 0;

  return (
    // Its own column, so the status line sits tight under the project's name
    // while everything below it keeps the page's own spacing.
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {entries.length > 0 ? <p className="text-small text-fg-muted">{sentence}</p> : null}
        <ScanStatus activity={activity} />
      </div>

      <ActivityPoll busy={isBusy(activity)} />
      <PeopleStrip entries={entries} />
      <FeedFilters facets={facets} />

      <OpeningProvider serverSelectedId={selectedId}>
        <LeadWorkspace
          list={
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-surface px-3 py-2">
                <span className="text-mono tracking-wide text-fg-muted uppercase">Leads</span>
                <span className="text-mono tabular-nums text-fg-muted">{entries.length}</span>
              </div>
              {entries.length === 0 ? (
                <p className="text-small p-3 text-fg-muted">
                  {status !== "new" ? (
                    EMPTY_SENTENCE[status]
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
                entries.map((entry) => (
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
                ))
              )}
              {held.length > 0 ? (
                <HeldSection items={held} params={params} selectedId={selectedId} />
              ) : null}
            </>
          }
          pane={
            selection ? <LeadDetail selection={selection} projectId={projectId} /> : null
          }
        />
      </OpeningProvider>
    </div>
  );
}
