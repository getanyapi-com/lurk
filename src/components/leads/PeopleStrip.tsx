import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { scoreRing, timeline } from "@/components/leads/stream";
import { atSentence } from "@/lib/feed";
import { cn } from "@/lib/utils";
import type { FeedParams, FeedWindow, Grain, LeadFace } from "@/lib/feed";

import type { StreamColumn } from "@/components/leads/stream";

type PeopleStripProps = {
  faces: LeadFace[];
  days: FeedWindow;
  /** The slice of the clock the feed is narrowed to, when a column was clicked. */
  at?: string;
  /** The filters the page is on, so a column keeps them when it adds its own. */
  params: FeedParams;
};

/**
 * How many faces one column stacks before the rest become a count. Four keeps
 * the card about a hundred pixels tall on the busiest day a project has had,
 * which is what lets the strip sit over the feed instead of pushing it down.
 */
const STACK = 4;

/** What the window over the strip is called, in the sentence above it. */
const WINDOW: Record<`${FeedWindow}`, string> = {
  "1": "the last 24 hours",
  "7": "the last 7 days",
  "30": "the last 30 days",
  all: "all time",
};

/** What one column of this strip is, in the words the hover hint uses. */
const GRAIN: Record<Grain, string> = { month: "month", day: "day", hour: "hour" };

/** The same page, with one slice picked or given back. */
function href(params: FeedParams, at: string | null): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    // The open thread is dropped: it is one lead out of the old window, and
    // the pane would keep showing it from outside the slice just chosen.
    if (value && name !== "lead" && name !== "at") {
      query.set(name, value);
    }
  }
  if (at) {
    query.set("at", at);
  }
  return `?${query.toString()}`;
}

function counted(column: StreamColumn): string {
  const total = column.faces.length;
  return `${total} ${total === 1 ? "lead" : "leads"}`;
}

/**
 * Every person this project has a lead on, laid along the window they posted
 * in. Only leads: a face here is someone worth answering.
 *
 * The whole window is drawn at once, columns sized off the card's width, so
 * there is nothing to scroll sideways for. What it was before was a row of
 * days that ran off the edge, and a month of leads meant the newest three days
 * on screen and the rest of the shape of the month behind a scrollbar.
 *
 * Every column is a link to the slice it draws - a month, a day, an hour -
 * and the column says so before it is clicked: hovering lights the whole of it
 * and names what clicking would do. The one already picked stays lit, and
 * clicking it again is how it is given back.
 *
 * The faces are the people's own Reddit pictures and nothing else. The Reddit
 * mark a row wears on its corner is not here: every face in the strip is from
 * Reddit, so sixty copies of the same mark said nothing and covered a sixth of
 * each picture at the size these are drawn.
 */
export function PeopleStrip({ faces, days, at, params }: PeopleStripProps) {
  if (faces.length === 0) {
    return null;
  }
  const { columns, ticks, grain, live: now } = timeline(faces, { days, at });
  const label = new Map(ticks.map((tick) => [tick.index, tick]));
  const last = columns.length - 1;
  // The strip is drawn newest first, so the slice happening now is the one on
  // the left rather than the one at the far end.
  const NOW = 0;
  return (
    <figure className="@container flex flex-col gap-3 rounded-card border bg-surface px-4 pt-4 pb-3">
      <figcaption className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-h3" style={{ fontWeight: 500 }}>
          {faces.length} {faces.length === 1 ? "lead" : "leads"}{" "}
          {at ? atSentence(at) : `in ${WINDOW[`${days}`]}`}.
        </span>
        {at ? (
          <Link className="text-small text-fg-muted underline" href={href(params, null)}>
            Back to {WINDOW[`${days}`]}
          </Link>
        ) : (
          <span className="text-small text-fg-muted">Pick a {GRAIN[grain]} to filter the feed.</span>
        )}
      </figcaption>

      <div
        className="grid gap-x-1 @2xl:gap-x-2"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((column, index) => {
          const picked = column.key === at;
          const tick = label.get(index);
          // A slice nobody posted in is not a filter worth offering: it would
          // empty the feed to say what the column already says. The picked one
          // stays a link whatever it holds, because it is how it is given back.
          const live = picked || column.faces.length > 0;
          const inside = cn(
            "group relative flex h-full flex-col items-center justify-end gap-1 rounded-card py-1 transition-motion",
            picked ? "bg-surface-2 ring-1 ring-border" : live ? "hover:bg-surface-2" : null,
          );
          const body = (
            <>
              {/* Dropped on a narrow card, where a column is thinner than the
                  number is wide and five of them ran into one another. */}
              {column.faces.length > STACK ? (
                <span className="text-mono hidden tabular-nums text-fg-muted @2xl:block">
                  +{column.faces.length - STACK}
                </span>
              ) : null}
              {/* Best last, so the strongest lead sits on the baseline. */}
              {column.faces
                .slice(0, STACK)
                .reverse()
                .map((face) => (
                  <span
                    key={face.id}
                    className={cn(
                      // min-h-0 is what keeps it round. A face is a flex item,
                      // and a flex item is at least as tall as its content
                      // wants to be: some of these are portraits twice as tall
                      // as they are wide, and that minimum beat the square.
                      "aspect-square w-full max-w-[34px] min-h-0 rounded-full",
                      scoreRing(face.score),
                    )}
                    title={`u/${face.author ?? "unknown"} in r/${face.subreddit}`}
                  >
                    <Avatar name={face.author} src={face.avatarUrl} size="fluid" />
                  </span>
                ))}
              {column.faces.length === 0 ? (
                // A quiet slice still takes up its room, and says so: the dot
                // is a face's box, so it sits on the middle of the baseline.
                <span className="flex aspect-square w-full max-w-[34px] items-center justify-center">
                  <span className="size-1 rounded-full bg-border" />
                </span>
              ) : null}

              {/* The axis, and the hint, on the same line under the column. The
                  hint is a chip so it can be wider than the column it belongs
                  to and still be read over its neighbours. */}
              <span className="relative mt-1 flex h-4 w-full items-center justify-center">
                {tick ? (
                  <span
                    className={cn(
                      "text-mono whitespace-nowrap group-hover:opacity-0",
                      tick.sparse ? null : "hidden @2xl:block",
                      picked
                        ? "text-fg"
                        : index === NOW && now
                          ? "text-score-hot"
                          : "text-fg-muted",
                    )}
                  >
                    {tick.label}
                  </span>
                ) : null}
                {live ? (
                  <span
                    className={cn(
                      "text-mono pointer-events-none absolute z-10 hidden whitespace-nowrap rounded-control border bg-surface px-1.5 py-0.5 text-fg shadow-sm group-hover:block",
                      index === 0
                        ? "left-0"
                        : index === last
                          ? "right-0"
                          : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    {picked ? "Clear" : "Filter to"} {column.label} · {counted(column)}
                  </span>
                ) : null}
              </span>
            </>
          );
          return live ? (
            // The whole slice lights up, not the face under the pointer: what
            // the click narrows to is the column, so that is what it shows.
            <Link
              key={column.key}
              href={href(params, picked ? null : column.key)}
              className={inside}
            >
              {body}
            </Link>
          ) : (
            <div key={column.key} className={inside}>
              {body}
            </div>
          );
        })}
      </div>
    </figure>
  );
}
