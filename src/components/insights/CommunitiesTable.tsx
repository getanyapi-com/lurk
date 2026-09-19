import { SubredditChip } from "@/components/SubredditChip";
import type { CommunityRow } from "@/lib/insights/read";

type CommunitiesTableProps = { rows: CommunityRow[] };

function activeUsers(value: number | null): string {
  return value == null ? "-" : value.toLocaleString("en-US");
}

/** Where the leads come from, and what each community allows you to say. */
export function CommunitiesTable({ rows }: CommunitiesTableProps) {
  return (
    <div className="overflow-x-auto rounded-card border bg-surface">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b text-left text-small text-fg-muted">
            <th className="p-4" style={{ fontWeight: 400 }}>
              Community
            </th>
            <th className="p-4" style={{ fontWeight: 400 }}>
              Leads
            </th>
            <th className="p-4" style={{ fontWeight: 400 }}>
              Average score
            </th>
            <th className="p-4" style={{ fontWeight: 400 }}>
              Self-promotion
            </th>
            <th className="p-4" style={{ fontWeight: 400 }}>
              Weekly active users
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="p-4 text-fg-muted" colSpan={5}>
                No leads yet, so there is nothing to compare.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.name} className="border-b last:border-0">
                <td className="p-4">
                  <SubredditChip name={row.name} iconUrl={row.iconUrl} />
                </td>
                <td className="p-4 tabular-nums">{row.leads}</td>
                <td className="p-4 tabular-nums">{row.averageScore}</td>
                <td className="p-4 text-small text-fg-muted">
                  {row.promoPolicy ?? "No rule stored yet"}
                </td>
                <td className="p-4 tabular-nums">{activeUsers(row.weeklyActiveUsers)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
