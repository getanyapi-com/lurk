import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * `mark` is a brand image shown before the label, for a tab named after a
 * platform; `icon` is drawn there instead when the mark is not an image.
 */
export type PillTab = { id: string; label: string; mark?: string; icon?: React.ReactNode };

/*
 * The strip's look lives here rather than beside PillTabs, which is a client
 * module: a server component importing a constant from one gets a reference to
 * it, not the string.
 */

/** The muted track the tabs sit in. */
export const PILL_TRACK = "inline-flex gap-1 rounded-control bg-surface-2 p-1";

/** One tab, raised onto the surface while it is the active one. */
export function pillItem(active: boolean): string {
  return cn(
    "transition-motion inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-small transition-colors",
    active ? "border bg-surface text-fg" : "border border-transparent text-fg-muted hover:text-fg",
  );
}

/** What a tab draws before its label: its icon, its brand mark, or nothing. */
export function PillTabMark({ tab }: { tab: PillTab }) {
  return (
    tab.icon ??
    (tab.mark ? (
      // Brand art from public/brands; no image proxy needed.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={tab.mark} alt="" width={14} height={14} />
    ) : null)
  );
}

/**
 * The pill strip as links, for tabs that are each their own page: the URL
 * says which is open, and a tab can be linked to.
 */
export function PillLinkTabs({
  tabs,
  activeId,
  label,
  className,
}: {
  tabs: (PillTab & { href: string })[];
  activeId: string;
  /** Names the strip, which then stands as a nav landmark rather than a plain row of links. */
  label?: string;
  className?: string;
}) {
  const Strip = label ? "nav" : "div";
  return (
    <Strip aria-label={label} className={cn(PILL_TRACK, className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === activeId ? "page" : undefined}
          className={pillItem(tab.id === activeId)}
        >
          <PillTabMark tab={tab} />
          {tab.label}
        </Link>
      ))}
    </Strip>
  );
}
