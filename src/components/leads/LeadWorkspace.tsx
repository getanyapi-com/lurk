"use client";

import { OpeningPane } from "@/components/leads/OpeningPane";
import { useOpening } from "@/components/leads/opening";

/**
 * Both panes fill the window under the pinned header, inside the page gutter,
 * so the list scrolls against a post that stays put. Every term is a token.
 */
const PANE_HEIGHT = "calc(100dvh - var(--header-height) - var(--page-gutter) * 2)";
const PANE_TOP = "calc(var(--header-height) + var(--page-gutter))";

const COLUMN = "sticky flex flex-col rounded-card border bg-surface";

/**
 * The list and the thread, side by side. It is a client component only so that
 * clicking a row can open the thread on what the row already knows, while the
 * server reads the rest.
 */
export function LeadWorkspace({
  list,
  pane,
}: {
  list: React.ReactNode;
  /** The thread the server is showing, or nothing when there is none to show. */
  pane: React.ReactNode;
}) {
  const { summary } = useOpening();
  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
      <div
        className={`${COLUMN} overflow-y-auto`}
        style={{ top: PANE_TOP, maxHeight: PANE_HEIGHT }}
      >
        {list}
      </div>
      {summary || pane ? (
        <div
          className={`${COLUMN} overflow-hidden`}
          style={{ top: PANE_TOP, maxHeight: PANE_HEIGHT }}
        >
          {summary ? <OpeningPane summary={summary} /> : pane}
        </div>
      ) : null}
    </div>
  );
}
