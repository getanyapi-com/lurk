import { CompetitorChip } from "@/components/competitors/CompetitorChip";
import type { MentionSeries } from "@/lib/competitors/read";

type MentionsBarProps = {
  series: MentionSeries[];
  /** The site each competitor sells from, keyed by name. */
  domains: Record<string, string | null>;
};

/** A day with no mention still draws a hairline, so the axis stays readable. */
const EMPTY_BAR_PERCENT = 4;

/** One row of daily bars per competitor, all rows sharing one scale. */
export function MentionsBar({ series, domains }: MentionsBarProps) {
  const peak = Math.max(1, ...series.flatMap((row) => row.days));
  return (
    <div className="flex flex-col gap-4 rounded-card border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          Mentions over the last 30 days
        </h2>
        <p className="text-small text-fg-muted">One bar per day, oldest on the left.</p>
      </div>
      {series.map((row) => (
        <div key={row.competitor} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <CompetitorChip name={row.competitor} domain={domains[row.competitor] ?? null} />
            <span className="text-small tabular-nums text-fg-muted">
              {row.total} {row.total === 1 ? "mention" : "mentions"}
            </span>
          </div>
          <div className="flex h-12 items-end justify-between gap-1.5">
            {row.days.map((value, index) => (
              <span
                key={index}
                title={`${value} on day ${index + 1}`}
                className="max-w-3 flex-1 rounded-t-sm"
                style={{
                  height: `${value === 0 ? EMPTY_BAR_PERCENT : Math.max(12, (value / peak) * 100)}%`,
                  backgroundColor: value === 0 ? "var(--border)" : "var(--fg)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
