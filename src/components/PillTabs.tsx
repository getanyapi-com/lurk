"use client";

import { PILL_TRACK, PillTabMark, pillItem, type PillTab } from "@/components/PillLinkTabs";
import { cn } from "@/lib/utils";

type PillTabsProps = {
  tabs: PillTab[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
};

/** A pill tab strip: muted track, active tab raised onto the surface. */
export function PillTabs({ tabs, activeId, onSelect, className }: PillTabsProps) {
  return (
    <div role="tablist" className={cn(PILL_TRACK, className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          onClick={() => onSelect(tab.id)}
          className={pillItem(tab.id === activeId)}
        >
          <PillTabMark tab={tab} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
