import Link from "next/link";
import { openXAction, scanXNowAction } from "@/app/app/x/actions";
import { PaidButton } from "@/components/PaidButton";
import { ListSkeleton } from "@/components/Skeleton";
import { StartOnOpen } from "@/components/StartOnOpen";
import { VerdictBadge } from "@/components/VerdictBadge";
import { LeadWorkspace } from "@/components/leads/LeadWorkspace";
import { OpeningProvider } from "@/components/leads/opening";
import { PeopleStrip } from "@/components/leads/PeopleStrip";
import { Fleeting } from "@/components/Fleeting";
import { ScanDone, ScanRunning } from "@/components/leads/ScanBanner";
import { entryHref } from "@/components/leads/workspace";
import { XFilters } from "@/components/x/XFilters";
import { XLeftOutSection, XMaybeSection, XSearches } from "@/components/x/XGroups";
import { filteredPointer } from "@/components/x/filtered";
import { XLeadDetail, type XSelection } from "@/components/x/XLeadDetail";
import { XLeadRow, repliedHandle } from "@/components/x/XLeadRow";
import { XReplyChip } from "@/components/x/XReplyChip";
import { config } from "@/lib/config";
import { atBounds, atKey, grainOf, type FeedParams } from "@/lib/feed";
import { compactCount, relativeAge, relativeUntil } from "@/lib/format";
import { limitsForUser } from "@/lib/tier";
import { DAY_MS } from "@/lib/time";
import { QUIET_RECHECK_DAYS } from "@/lib/x/constants";
import { allowanceFor } from "@/lib/throttle";
import { withParams } from "@/lib/url";
import {
  X_STATUSES,
  listXFaces,
  listXFiltered,
  listXHeld,
  listXLanes,
  listXLeads,
  projectedWalletCostPerDay,
  xEvaluationEntry,
  xLeadById,
  xThreadOf,
  xStatus,
  type XFeedFilter,
  type XFiltered,
  type XFilteredCard,
  type XHeldCard,
  type XLeadCard,
  type XStatus,
  type XStatusFilter,
} from "@/lib/x/read";

const NOTHING_FILTERED: XFiltered = { items: [], judged: 0, screened: 0, unfinished: 0, closeCalls: 0, worth: 0, pending: 0 };

export type XParams = { project?: string; days?: string; status?: string; at?: string; lead?: string };

/**
 * What a row says after its age: how many had seen the post at lurk's last
 * fetch of it (X's count then, never an estimate; the pane says when), for
 * a reply-worthy post whether a reply now still lands, and for a post found
 * through a reply in its thread whose reply that was.
 */
function rowMeta(lead: XLeadCard): string | null {
  const views = lead.viewCount !== null && lead.viewCount > 0 ? `${compactCount(lead.viewCount)} views` : null;
  const via = lead.via && !lead.foundBy ? `via @${lead.via.author}'s reply` : null;
  return [lead.kind === "reply" && lead.fresh ? "reply now" : null, views, via].filter(Boolean).join(" · ") || null;
}

/** How long after a check ends its banner may still be shown once, to someone who opens the tab late. */
const DONE_BANNER_MS = 30 * 60_000;

/**
 * The check's own word over the list: a card while X is being searched, a
 * banner once, for a few seconds, when a check has just ended, and nothing after that, when the status
 * line alone says when X was checked.
 */
function ScanState({ status, now }: { status: XStatus; now: Date }) {
  if (status.running) {
    return <ScanRunning text={`${statusLine(status)} Leads appear below as they are found.`} />;
  }
  const run = status.lastRun;
  if (!run?.finishedAt || status.lastFailure || now.getTime() - run.finishedAt.getTime() > DONE_BANNER_MS) {
    return null;
  }
  const found = run.leads + run.replies;
  const next = status.nextScanAt ? ` Next check ${relativeUntil(status.nextScanAt)}.` : "";
  return (
    <Fleeting id={`x-done:${run.id}`}>
      <ScanDone
        title={found === 0 ? "X scan done. No leads this time." : `X scan done. Found ${found} ${found === 1 ? "lead" : "leads"}.`}
        line={`Read ${run.postsNew.toLocaleString()} new ${run.postsNew === 1 ? "post" : "posts"} on X.${next}`}
      />
    </Fleeting>
  );
}

/** What X did last and does next, as one line, where the Leads tab puts its scan status. */
function statusLine(status: XStatus): string {
  if (status.running) {
    return status.running.progress ? `Searching X now: ${status.running.progress}` : "Searching X now.";
  }
  if (status.lastFailure) {
    const retry = status.nextScanAt ? ` Trying again ${relativeUntil(status.nextScanAt)}.` : " Trying again within the hour.";
    return `The last X search stopped: ${status.lastFailure}.${retry}`;
  }
  const last = status.lastScanAt ? `Checked X ${relativeAge(status.lastScanAt)}.` : "X has not been checked yet.";
  const next = status.nextScanAt ? ` Next check ${relativeUntil(status.nextScanAt)}.` : "";
  return `${last}${next}${quietClause(status)}`;
}

/**
 * The status line's word on quiet: "checked weekly" only once the booked check
 * really is a week after the last one, since a check booked before X went
 * quiet still runs at the plan's cadence.
 */
function quietClause(status: XStatus): string {
  if (!status.quiet.quiet || status.lastFailure) return "";
  const weekly =
    status.nextScanAt && status.lastScanAt && status.nextScanAt.getTime() - status.lastScanAt.getTime() >= (QUIET_RECHECK_DAYS - 1) * DAY_MS;
  return weekly ? " X is quiet for this product, so it is checked weekly." : " X is quiet for this product, so after the next check it is checked weekly.";
}

/** A slice key the strip could have made, or nothing. */
function validAt(at: string | undefined): string | undefined {
  const grain = at ? grainOf(at) : null;
  return at && grain && atKey(atBounds(at).start, grain) === at ? at : undefined;
}

/** The filters the list is on, without the open post. */
function listSearch(params: XParams): string {
  return withParams(params, { lead: undefined });
}

/**
 * The post the pane opens on: the one the URL names, even once it has left the
 * list (just marked replied, hidden or not a fit), or else the newest lead. A
 * held or filtered-out post opens only when asked for: with no leads it would
 * front an empty list with a post the list itself says is not a lead.
 */
async function openOn(
  projectId: string,
  leads: XLeadCard[],
  held: XHeldCard[],
  filtered: XFilteredCard[],
  requested?: string,
): Promise<XSelection | null> {
  const lead = leads.find((one) => one.entryId === requested);
  if (lead) {
    return { kind: "lead", lead };
  }
  const item = held.find((one) => one.entryId === requested);
  if (item) {
    return { kind: "held", item };
  }
  const out = filtered.find((one) => one.entryId === requested);
  if (out) {
    return { kind: "filtered", item: out };
  }
  // A held or filtered-out post the list no longer has: pushed past the cap by
  // a scan, outside a narrower window, or since held, left out or made a lead.
  // It keeps the id it was asked by, which is what the opening row waits for.
  const evaluationId = requested?.match(/^(?:held|filtered)-(.+)$/u)?.[1];
  if (requested && evaluationId) {
    const entry = await xEvaluationEntry(projectId, evaluationId);
    if (entry?.kind === "lead") return { kind: "lead", lead: { ...entry.lead, entryId: requested } };
    if (entry?.kind === "held") return { kind: "held", item: { ...entry.item, entryId: requested } };
    if (entry?.kind === "filtered") return { kind: "filtered", item: { ...entry.item, entryId: requested } };
  }
  if (requested?.startsWith("lead-")) {
    const moved = await xLeadById(projectId, requested.slice("lead-".length));
    if (moved) return { kind: "lead", lead: moved };
  }
  return leads[0] ? { kind: "lead", lead: leads[0] } : null;
}

/** A group's name and count, stuck to the top of the list column while its rows scroll under it. */
function GroupHeader({ label, count, note }: { label: string; count: number; note?: string | null }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-surface px-3 py-2">
      <span className="text-mono tracking-wide text-fg-muted uppercase">{label}</span>
      <span className="text-mono tabular-nums text-fg-muted">{count}</span>
      {note ? <span className="text-mono tabular-nums text-fg-muted">{note}</span> : null}
    </div>
  );
}

/** The list while the first check fills it, in the Leads tab's own arriving shape. */
function ArrivingLeads() {
  return (
    <div className="flex flex-col">
      <p className="text-small border-b p-3 text-fg-muted">
        lurk is reading the last 30 days of X for people asking for what you do, leaving the products you compete with or
        building their own, and popular posts showing how people do what you sell, and keeps watching from here. X
        matches words exactly, so this is a short list, not a feed: a few posts a week is normal, and some products see
        none.
      </p>
      <ListSkeleton rows={4} bare fade={0.2} />
    </div>
  );
}

/** Why the list is empty, in one sentence. */
function emptySentence(
  filter: XFeedFilter,
  status: XStatus,
  laneCount: number,
  activeCount: number,
  name: string,
  canScanNow: boolean,
): string {
  if (laneCount === 0 && status.lastScanAt) {
    return "lurk has no X searches for this product yet. Adding the products you compete with on the Product page gives it more to look for.";
  }
  if (filter.status !== "new") {
    return filter.status === "hidden"
      ? "No X leads you hid in this window."
      : filter.status === "replied"
        ? "No X leads you marked replied in this window."
        : "No X leads you marked a miss in this window.";
  }
  if (!status.lastScanAt && status.lastFailure) {
    return "lurk's first read of the last 30 days on X stopped before it finished, so this list is not complete yet. lurk tries again on its own and shows anyone it finds here. Your Reddit leads are unaffected.";
  }
  // Only a spent budget or an empty wallet explains an empty list; a lookup that failed does not.
  const partial = status.lastRun?.partialReason ?? "";
  if (/budget|cap|balance|spent|wallet/iu.test(partial)) {
    return `${partial.replace(/\.?$/u, ".")} Your Reddit leads are unaffected.`;
  }
  if (status.quiet.quiet && !status.lastFailure) {
    const sooner = canScanNow ? " Scan now still checks at once." : "";
    const read =
      status.quiet.days >= 1
        ? `${status.quiet.posts} posts on X from the last ${status.quiet.days} days`
        : `${status.quiet.posts} recent posts on X`;
    return `X is quiet for ${name}. lurk read ${read}, and nobody asked for what you do, left a competitor, built their own or showed how they do what you sell: the people who buy this may not talk about it on X. lurk checks again each week you open this tab, or while your alerts are on, and shows anyone who turns up.${sooner} Your Reddit leads are unaffected.`;
  }
  if (activeCount === 0) {
    return "Your X searches are paused: they found nothing worth showing, or nothing at all for days. Quiet ones are tried again each week, and changing your product or competitors on the Product page starts them all again.";
  }
  return status.lastRun
    ? `Nobody on X asked for what you do or posted anything worth a reply in this window. The last check saw ${status.lastRun.postsNew} new posts and judged ${status.lastRun.judged}.`
    : "Nobody on X asked for what you do or posted anything worth a reply in this window.";
}

/**
 * The X tab for one project, drawn the way the Leads tab is: the project's
 * name and Scan now, one status line, the people strip carrying the filter
 * pills, then the list and the open post side by side. The page above it
 * checks the switch and the owner; this only draws.
 */
export async function XTab({ userId, project, params }: { userId: string; project: { id: string; name: string }; params: XParams }) {
  const filter: XFeedFilter = {
    days: params.days === "1" ? 1 : params.days === "7" ? 7 : 30,
    status: (X_STATUSES as readonly string[]).includes(params.status ?? "") ? (params.status as XStatusFilter) : "new",
    at: validAt(params.at),
  };

  const tier = await limitsForUser(userId);
  const [status, found, held, filtered, lanes, faces, allowance] = await Promise.all([
    xStatus(project.id),
    listXLeads(project.id, filter),
    filter.status === "new" ? listXHeld(project.id, filter) : Promise.resolve([]),
    filter.status === "new" ? listXFiltered(project.id, filter) : Promise.resolve(NOTHING_FILTERED),
    listXLanes(project.id),
    listXFaces(project.id, filter),
    allowanceFor(userId, "x_scan_now"),
  ]);
  const activeLanes = lanes.filter((lane) => lane.state === "active");
  // Until the first check finishes there is nothing to scan again or to price.
  const firstCheck = !status.lastScanAt;
  const asks = found.filter((lead) => lead.kind === "ask");
  // X_REPLIES off hides replies already found, as well as stopping new ones.
  const replies = config().X_REPLIES ? found.filter((lead) => lead.kind === "reply") : [];
  // Asks first, then posts worth a reply, in one list: each row's badge says which it is.
  const leads = [...asks, ...replies];
  const selection = await openOn(project.id, leads, held, filtered.items, params.lead);
  const selectedId = selection ? (selection.kind === "lead" ? selection.lead.entryId : selection.item.entryId) : null;
  const selectedCard = selection ? (selection.kind === "lead" ? selection.lead : selection.item) : null;
  const thread = selectedCard ? await xThreadOf(selectedCard.tweetId, selectedCard.via?.tweetId ?? null) : null;
  const row = (lead: XLeadCard, trailing: React.ReactNode, meta: string | null = null) => (
    <XLeadRow
      key={lead.entryId}
      id={lead.entryId}
      href={entryHref(params, lead.entryId)}
      selected={lead.entryId === selectedId}
      headline={lead.headline}
      author={lead.authorUsername}
      avatarUrl={lead.authorImage}
      createdAt={lead.postedAt}
      replyingTo={repliedHandle(lead.replyingTo)}
      meta={meta}
      trailing={trailing}
    />
  );

  return (
    // The Leads tab's frame: from lg up the page is the window under the
    // header, and the list and the post each scroll inside themselves.
    <div
      key={project.id}
      className="flex flex-col gap-1 lg:h-[calc(100dvh_-_var(--header-height)_-_var(--page-gutter)_*_2)]"
    >
      <StartOnOpen start={openXAction.bind(null, project.id)} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-h3 flex items-baseline gap-2" style={{ fontWeight: 500 }}>
          {project.name}
          <span className="text-mono tracking-wide text-fg-muted uppercase">X leads · beta</span>
        </h2>
        {firstCheck ? null : (
          <form action={scanXNowAction.bind(null, project.id)}>
            <PaidButton label="Scan now" allowance={allowance} note="beside" />
          </form>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
        <ScanState status={status} now={new Date()} />
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          {status.running ? null : <p className="text-small text-fg-muted">{statusLine(status)}</p>}
          {tier.name === "free" && tier.limits && !firstCheck && activeLanes.length > 0 && !status.quiet.quiet ? (
            <p className="text-small text-fg-muted">
              Free checks X once a day; a connected wallet checks every search hourly,
              about ${projectedWalletCostPerDay(activeLanes).toFixed(2)} a day from your own balance at this project&apos;s
              volume.{" "}
              <Link href="/app/settings" className="underline">
                Connect a wallet
              </Link>
            </p>
          ) : null}
        </div>

        <PeopleStrip
          faces={faces}
          days={filter.days}
          at={filter.at}
          params={params as FeedParams}
          filters={<XFilters days={String(filter.days)} status={filter.status} />}
        />

        <OpeningProvider serverSelectedId={selectedId}>
          <LeadWorkspace
            asked={Boolean(params.lead)}
            backHref={`?${listSearch(params)}`}
            list={
              <>
                {/* The count is asks, as the strip and the rail count them; posts worth a reply are noted beside it. */}
                <GroupHeader label="Leads" count={asks.length} note={replies.length > 0 ? `+ ${replies.length} to reply to` : null} />
                {leads.length === 0 && firstCheck && (status.running || !status.lastFailure) && filter.status === "new" ? (
                  <ArrivingLeads />
                ) : leads.length === 0 ? (
                  <p className="text-small p-3 text-fg-muted">
                    {emptySentence(filter, status, lanes.length, activeLanes.length, project.name, !allowance.spent)}
                    {filter.status === "new" ? ` ${filteredPointer(filtered, held.length) ?? ""}` : null}
                  </p>
                ) : (
                  leads.map((lead) =>
                    row(
                      lead,
                      lead.kind === "ask" ? <VerdictBadge fit={lead.fit} intent={lead.intent} /> : <XReplyChip moment={lead.moment} />,
                      rowMeta(lead),
                    ),
                  )
                )}
                <XMaybeSection held={held} filtered={filtered} params={params} selectedId={selectedId} />
                <XLeftOutSection filtered={filtered} params={params} selectedId={selectedId} />
                <XSearches lanes={lanes} />
              </>
            }
            pane={selection ? <XLeadDetail selection={selection} projectId={project.id} thread={thread} /> : null}
          />
        </OpeningProvider>
      </div>
    </div>
  );
}
