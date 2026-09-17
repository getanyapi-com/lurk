import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { scoreRing, timeline } from "@/components/leads/stream";
import { cn } from "@/lib/utils";
import type { FeedParams, FeedWindow, LeadFace } from "@/lib/feed";

import type { StreamColumn } from "@/components/leads/stream";

type PeopleStripProps = {
  faces: LeadFace[];
  days: FeedWindow;
  /** The one day the feed is narrowed to, when a column has been clicked. */
  day?: string;
  /** The filters the page is on, so a column keeps them when it adds its day. */
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
  "1": "in the last 24 hours",
  "7": "in the last 7 days",
  "30": "in the last 30 days",
  all: "in all time",
};

/** The same page, with one day picked or given back. */
function href(params: FeedParams, day: string | null): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    // The open thread is dropped: it is one lead out of the old window, and
    // the pane would keep showing it from outside the day just chosen.
    if (value && name !== "lead" && name !== "day") {
      query.set(name, value);
    }
  }
  if (day) {
    query.set("day", day);
  }
  return `?${query.toString()}`;
}

function longDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

function count(column: StreamColumn): string {
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
 * A column that is one day is a link to that day: hovering lights the whole
 * column, and clicking narrows the feed under it to the people in it.
 *
 * The faces are the people's own Reddit pictures and nothing else. The Reddit
 * mark a row wears on its corner is not here: every face in the strip is from
 * Reddit, so sixty copies of the same mark said nothing and covered a sixth of
 * each picture at the size these are drawn.
 */
export function PeopleStrip({ faces, days, day, params }: PeopleStripProps) {
  if (faces.length === 0) {
    return null;
  }
  const { columns, ticks, live } = timeline(faces, { days, day });
  const track = { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` };
  const last = ticks.length - 1;
  return (
    <figure className="@container flex flex-col gap-4 rounded-card border bg-surface px-4 pt-4 pb-3">
      <figcaption className="text-h3 flex flex-wrap items-baseline gap-x-2" style={{ fontWeight: 500 }}>
        <span>
          {faces.length} {faces.length === 1 ? "lead" : "leads"}{" "}
          {day ? `on ${longDay(day)}` : WINDOW[`${days}`]}.
        </span>
        {day ? (
          <Link className="text-small font-normal text-fg-muted underline" href={href(params, null)}>
            Back to {WINDOW[`${days}`].replace("in ", "")}
          </Link>
        ) : null}
      </figcaption>

      <div className="grid gap-x-1 @2xl:gap-x-2" style={track}>
        {columns.map((column) => {
          const stack = (
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
                      // wants to be: two of these are portraits twice as tall
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
            </>
          );
          const inside = "flex h-full flex-col items-center justify-end gap-1 rounded-card py-1";
          return column.day ? (
            <Link
              key={column.at}
              href={href(params, column.day)}
              // The whole day lights up, not the face under the pointer: what
              // the click narrows to is the column, so that is what it shows.
              className={cn(inside, "transition-motion hover:bg-surface-2")}
              title={`${count(column)} on ${longDay(column.day)}`}
            >
              {stack}
            </Link>
          ) : (
            <div key={column.at} className={inside}>
              {stack}
            </div>
          );
        })}
      </div>

      <div className="text-mono grid gap-x-1 text-fg-muted @2xl:gap-x-2" style={track}>
        {ticks.map((tick, index) => (
          <span
            key={tick.index}
            className={cn(
              "whitespace-nowrap",
              // Now is the end of the axis and the label worth reading, so it
              // is the one kept inside the card and the one given the colour.
              index === last
                ? cn("justify-self-end", live && "text-score-hot")
                : index === 0
                  ? "justify-self-start"
                  : "justify-self-center",
            )}
            style={{ gridColumn: tick.index + 1 }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
