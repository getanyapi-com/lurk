import { entryHref } from "@/components/leads/workspace";
import { XLeadRow, repliedHandle } from "./XLeadRow";
import { X_PRIORITY_FLOOR } from "@/lib/x/priority";
import { xOpportunityCard, type XOpportunity } from "@/lib/x/read";

/** One order, with an honest quality divider rather than separate certainty buckets. */
export function XOpportunityList({ items, params, selectedId, showDivider = true }: {
  items: XOpportunity[];
  params: Record<string, string | undefined>;
  selectedId: string | null;
  showDivider?: boolean;
}) {
  const weakAt = items.findIndex((item) => item.priority === null || item.priority < X_PRIORITY_FLOOR);
  return items.map((opportunity, index) => {
    const card = xOpportunityCard(opportunity.entry);
    const reply = opportunity.entry.kind === "lead" && opportunity.entry.lead.kind === "reply";
    const meta = [reply ? "public reply" : null, ...opportunity.checks].filter(Boolean).join(" · ") || null;
    return (
      <div key={card.entryId} className="border-b last:border-b-0">
        {showDivider && index === weakAt ? (
          <div className="border-y bg-surface-2 px-3 py-2">
            <p className="text-mono text-fg-muted">Weaker matches below</p>
            <p className="text-small text-fg-muted">Less evidence of a useful opportunity. Still available to review.</p>
          </div>
        ) : null}
        <XLeadRow
          id={card.entryId} href={entryHref(params, card.entryId)} selected={card.entryId === selectedId}
          headline={card.headline} author={card.authorUsername} avatarUrl={card.authorImage}
          createdAt={card.postedAt} replyingTo={repliedHandle(card.replyingTo)} meta={meta}
          trailing={showDivider ? (
            <span className="text-mono text-fg-muted tabular-nums" title="Relative attention priority, not a conversion probability">
              {opportunity.priority === null ? "unscored" : `priority ${Math.round(100 * opportunity.priority)}`}
            </span>
          ) : null}
        />
      </div>
    );
  });
}
