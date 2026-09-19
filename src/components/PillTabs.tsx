"use client";

import { cn } from "@/lib/utils";

/**
 * `mark` is a brand image shown before the label, for a tab named after a
 * platform; `icon` is drawn there instead when the mark is not an image.
 */
export type PillTab = { id: string; label: string; mark?: string; icon?: React.ReactNode };

type PillTabsProps = {
  tabs: PillTab[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
};

/** A pill tab strip: muted track, active tab raised onto the surface. */
export function PillTabs({ tabs, activeId, onSelect, className }: PillTabsProps) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex gap-1 rounded-control bg-surface-2 p-1", className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          onClick={() => onSelect(tab.id)}
          className={cn(
            "transition-motion inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-small transition-colors",
            tab.id === activeId
              ? "border bg-surface text-fg"
              : "border border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {tab.icon ?? (tab.mark ? (
            // Brand art from public/brands; no image proxy needed.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tab.mark} alt="" width={14} height={14} />
          ) : null)}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
