import { ChevronRight } from "lucide-react";
import { LeadRow } from "@/components/leads/LeadRow";
import { verdictFor } from "@/components/leads/verdict";
import { entryHref, heldEntryId } from "@/components/leads/workspace";

import type { ReviewItem } from "@/lib/feed";

type HeldSectionProps = {
  items: ReviewItem[];
  /** The filters the list is showing, so a held row keeps them when opened. */
  params: Record<string, string | undefined>;
  selectedId: string | null;
};

/**
 * The candidates the scan would not call either way, as the second group in
 * the list column and shut until asked for. They used to share the lead stream,
 * sorted by date, which on 2026-09-10 opened an all-time feed with four held
 * items above the first real lead. They are worth settling, but never worth
 * reading first. The group opens itself when one of them is what you are on.
 */
export function HeldSection({ items, params, selectedId }: HeldSectionProps) {
  const open = items.some((item) => heldEntryId(item) === selectedId);
  return (
    <details className="group border-t" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <ChevronRight
          className="transition-motion size-3.5 text-fg-muted group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="text-mono tracking-wide text-fg-muted uppercase">Held for review</span>
        <span className="text-mono tabular-nums text-fg-muted">{items.length}</span>
      </summary>
      <p className="text-small border-t px-3 py-2 text-fg-muted">
        The scan could not settle these either way. They are not leads.
      </p>
      {items.map((item) => {
        const verdict = verdictFor(item);
        const id = heldEntryId(item);
        return (
          <LeadRow
            key={item.id}
            id={id}
            href={entryHref(params, id)}
            selected={id === selectedId}
            title={item.title}
            author={item.author}
            avatarUrl={item.avatarUrl}
            subreddit={item.subreddit}
            subredditIconUrl={item.subredditIconUrl}
            createdAt={item.createdAt}
            trailing={
              <span
                className={`text-mono ${
                  verdict.tone === "warm" ? "text-score-warm" : "text-fg-muted"
                }`}
              >
                {verdict.label}
              </span>
            }
          />
        );
      })}
    </details>
  );
}
