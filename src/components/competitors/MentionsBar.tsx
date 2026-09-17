import {
  MENTION_WINDOW_DAYS,
  stackMentions,
  type MentionRow,
  type MentionSeries,
} from "@/lib/competitors/read";
import { cn } from "@/lib/utils";

type MentionsBarProps = { series: MentionSeries[] };

/** How tall the plot is, in pixels. Every bar is scaled against the busiest day. */
const CHART_HEIGHT = 160;

/** The surface left showing between two competitors in one bar, in pixels. */
const SEGMENT_GAP = 2;

/** A day nobody said anything still draws a hairline, so the axis stays readable. */
const EMPTY_BAR = 2;

/** How often the axis is labelled. Five labels is what a card this wide holds. */
const TICK_EVERY = 7;

/**
 * The colour a row wears. The slot is fixed by where the project lists the
 * competitor, so the same name is the same colour whatever the week did.
 */
function fill(slot: number | null): string {
  return slot === null ? "var(--series-other)" : `var(--series-${slot})`;
}

/** Which day a bar is, counting back from today. */
function daysAgo(index: number): string {
  if (index === 0) {
    return "today";
  }
  return index === 1 ? "yesterday" : `${index} days ago`;
}

/** What goes under a column, or nothing. Both ends always, and never crowded. */
function tickLabel(index: number, last: number): string | null {
  if (index === 0) {
    return "today";
  }
  if (index === last) {
    return `${last}d`;
  }
  return index % TICK_EVERY === 0 && last - index >= TICK_EVERY / 2 ? `${index}d` : null;
}

/** How many mentions one day holds, across every row the chart draws. */
function dayTotal(rows: MentionRow[], index: number): number {
  return rows.reduce((sum, row) => sum + row.days[index], 0);
}

/**
 * Every mention in the window laid along the days it happened on, as one
 * stacked bar per day: the height is how loudly Reddit talked about the things
 * you compete with, and the bands inside it are who it named.
 *
 * It was a row of bars per competitor before, one small chart stacked on the
 * next. That answered "is Jotform up this week" and could not answer "was
 * Tuesday loud", because the reader had to add four charts together by eye to
 * find out. Stacking puts the total and the split in the same mark: the bar's
 * height is the day, its bands are the names.
 *
 * Colour does the identity work here and nothing else, so it is drawn from a
 * validated categorical palette in a fixed order, with 2px of surface between
 * touching bands. Every value is also in the legend and in the hover, because
 * three of the light-mode hues sit under 3:1 on white and colour alone is
 * never allowed to be the only way to read a number.
 */
export function MentionsBar({ series }: MentionsBarProps) {
  const { rows, peak } = stackMentions(series);
  if (rows.length === 0) {
    return null;
  }
  const days = rows[0].days.length;
  const last = days - 1;
  const scale = CHART_HEIGHT / peak;
  // Drawn bottom up, so the first competitor the project listed sits on the
  // baseline and the stack always grows in the same order.
  const stack = [...rows].reverse();
  const columns = { gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` };
  return (
    <figure className="flex flex-col gap-4 rounded-card border bg-surface p-4">
      <figcaption className="flex flex-col gap-1">
        <span className="text-h3" style={{ fontWeight: 500 }}>
          Mentions over the last {MENTION_WINDOW_DAYS} days
        </span>
        <span className="text-small text-fg-muted">
          One bar per day, today on the left, split by who was named. The busiest day holds{" "}
          {peak} {peak === 1 ? "mention" : "mentions"}.
        </span>
      </figcaption>

      {/* The legend is the identity channel, and it carries the totals so the
          chart can be read without telling two hues apart. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {rows.map((row) => (
          <li key={row.competitor} className="flex items-center gap-1.5 text-small">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: fill(row.slot) }}
              aria-hidden="true"
            />
            <span className="text-fg">{row.competitor}</span>
            <span className="tabular-nums text-fg-muted">{row.total}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1">
        <div className="grid items-end gap-x-1 border-b" style={{ ...columns, minHeight: CHART_HEIGHT }}>
          {Array.from({ length: days }, (_, index) => {
            const total = dayTotal(rows, index);
            // The first non-empty band from the top is the one that gets the
            // rounded end; the rest are square, because they are joins.
            const cap = stack.findIndex((row) => row.days[index] > 0);
            return (
              <div key={index} className="group relative flex h-full justify-center">
                <div
                  className="flex w-full max-w-6 flex-col justify-end"
                  style={{ gap: SEGMENT_GAP }}
                >
                  {total === 0 ? (
                    <span
                      className="rounded-t-sm"
                      style={{ height: EMPTY_BAR, backgroundColor: "var(--border)" }}
                    />
                  ) : (
                    stack.map((row, n) =>
                      row.days[index] === 0 ? null : (
                        <span
                          key={row.competitor}
                          className={n === cap ? "rounded-t-sm" : undefined}
                          style={{
                            height: row.days[index] * scale,
                            backgroundColor: fill(row.slot),
                          }}
                        />
                      ),
                    )
                  )}
                </div>

                {/* The hover says the day and splits it, in the order the bar
                    stacks it, so the chip reads down the bar it points at. */}
                <div
                  className={cn(
                    "text-mono pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max flex-col gap-1 rounded-control border bg-surface px-2 py-1.5 text-fg shadow-sm group-hover:flex",
                    index === 0 ? "left-0" : index === last ? "right-0" : "left-1/2 -translate-x-1/2",
                  )}
                >
                  <span className="text-fg-muted">
                    {total === 0 ? "Nothing" : `${total} ${total === 1 ? "mention" : "mentions"}`}{" "}
                    {daysAgo(index)}
                  </span>
                  {stack.map((row) =>
                    row.days[index] === 0 ? null : (
                      <span key={row.competitor} className="flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: fill(row.slot) }}
                          aria-hidden="true"
                        />
                        {row.competitor}
                        <span className="ml-auto tabular-nums">{row.days[index]}</span>
                      </span>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-x-1" style={columns}>
          {Array.from({ length: days }, (_, index) => (
            <span key={index} className="text-mono whitespace-nowrap text-fg-muted">
              {tickLabel(index, last)}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
