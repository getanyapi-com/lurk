"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Box, Lightbulb, Menu, Radar, Receipt, Search, Settings, Swords, X } from "lucide-react";
import { ChannelMark } from "@/components/alerts/ChannelMark";
import { NEW_PROJECT_PATH } from "@/components/ProjectSwitcher";
import type { AlertChannel } from "@/lib/alerts/types";
import { cn } from "@/lib/utils";
import { AnyapiRailCard } from "./AnyapiRailCard";

/** One icon per destination, so the rail reads at a glance. */
const ICONS = {
  radar: Radar,
  search: Search,
  lightbulb: Lightbulb,
  swords: Swords,
  box: Box,
  bell: Bell,
  receipt: Receipt,
  settings: Settings,
} as const;

export type RailIcon = keyof typeof ICONS;

export type RailItem = {
  href: string;
  label: string;
  icon: RailIcon;
  count?: number;
  /** Where this page sends things, drawn small and grey after the label. */
  marks?: AlertChannel[];
};
export type RailGroup = { label: string; items: RailItem[] };

type RailProps = { groups: RailGroup[]; children?: React.ReactNode };

/**
 * Left navigation, grouped Engage / Research / Setup, with count pills. It is
 * pinned under the header rather than scrolled away with the page: it is how
 * you leave the page you are on, so it has to be reachable from the bottom of
 * a feed of eighty leads. It scrolls itself when it outgrows the viewport.
 *
 * Below md there is no room for a column beside the page, so the same rail is
 * a drawer: a button it draws over the header's left edge slides it in.
 */
export function Rail({ groups, children }: RailProps) {
  const pathname = usePathname();
  // A project that does not exist yet has no leads to count and no pages to
  // open, so its rail is the shape of one with nothing in it.
  const creating = pathname === NEW_PROJECT_PATH;
  const [open, setOpen] = useState(false);
  // Arriving somewhere is the drawer's job done, and switching project keeps
  // the pathname, so the project is part of where you are.
  const place = `${pathname}?${useSearchParams().get("project") ?? ""}`;
  const [openedAt, setOpenedAt] = useState(place);
  if (openedAt !== place) {
    setOpenedAt(place);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        className="fixed left-2 top-0 z-40 flex w-10 items-center justify-center text-fg md:hidden"
        style={{ height: "var(--header-height)" }}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          style={{ top: "var(--header-height)" }}
        />
      ) : null}
      <nav
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cn(
          "transition-motion fixed left-0 z-30 flex shrink-0 flex-col gap-6 self-start overflow-y-auto border-r bg-bg px-4 py-5 transition-transform md:sticky md:z-auto md:translate-x-0",
          open ? "translate-x-0" : "invisible -translate-x-full md:visible",
        )}
        style={{
          width: "var(--rail-width)",
          top: "var(--header-height)",
          height: "calc(100dvh - var(--header-height))",
        }}
      >
        {children}
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="px-2 pb-1 text-[11px] uppercase tracking-wide text-fg-muted">
              {group.label}
            </span>
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = ICONS[item.icon];
              if (creating) {
                return (
                  <span
                    key={item.href}
                    aria-disabled="true"
                    className="flex items-center gap-2 rounded-control px-2 py-1.5 text-body text-fg-muted opacity-50"
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </span>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "transition-motion flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-body transition-colors",
                    active
                      ? "bg-surface-2 text-fg"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon
                      className="size-4 shrink-0 text-fg-muted"
                      aria-hidden="true"
                    />
                    {item.label}
                    {item.marks ? (
                      <span className="flex items-center gap-1 opacity-60 grayscale">
                        {item.marks.map((mark) => (
                          <ChannelMark key={mark} channel={mark} size={12} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                  {item.count === undefined ? null : (
                    <span className="rounded-control bg-surface-2 px-1.5 text-small tabular-nums text-fg-muted">
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        <AnyapiRailCard />
      </nav>
    </>
  );
}
