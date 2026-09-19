"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { OpeningPane } from "@/components/leads/OpeningPane";
import { useOpening } from "@/components/leads/opening";

/**
 * From lg up, both panes fill the window under the pinned header, inside the
 * page gutter, so the list scrolls against a post that stays put. Every term
 * is a token.
 */
const PANE =
  "lg:sticky lg:top-[calc(var(--header-height)_+_var(--page-gutter))] lg:max-h-[calc(100dvh_-_var(--header-height)_-_var(--page-gutter)_*_2)]";

const COLUMN = "flex min-w-0 flex-col rounded-card border bg-surface";

/**
 * The list and the thread, side by side. It is a client component only so that
 * clicking a row can open the thread on what the row already knows, while the
 * server reads the rest.
 *
 * Below lg there is room for one of them. The list is the page, and a thread
 * somebody asked for covers it until they go back; the one the server picks
 * for an empty pane is nobody's ask, so there it stays out of the way.
 */
export function LeadWorkspace({
  list,
  pane,
  asked,
  backHref,
}: {
  list: React.ReactNode;
  /** The thread the server is showing, or nothing when there is none to show. */
  pane: React.ReactNode;
  /** Whether the URL names the thread, rather than the server choosing one. */
  asked: boolean;
  /** This list with no thread named, which is where Back goes. */
  backHref: string;
}) {
  const { summary, closed, close } = useOpening();
  const covering = !closed && (summary !== null || asked);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
      <div className={`${COLUMN} ${PANE} lg:overflow-y-auto`}>{list}</div>
      {summary || pane ? (
        <div
          className={`${COLUMN} ${PANE} overflow-hidden max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[var(--header-height)] max-lg:z-10 max-lg:rounded-none max-lg:border-0 ${
            covering ? "" : "max-lg:hidden"
          }`}
        >
          <Link
            href={backHref}
            scroll={false}
            onClick={close}
            className="text-small flex shrink-0 items-center gap-1 border-b px-3 py-2.5 text-fg-muted lg:hidden"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to leads
          </Link>
          {summary ? <OpeningPane summary={summary} /> : pane}
        </div>
      ) : null}
    </div>
  );
}
