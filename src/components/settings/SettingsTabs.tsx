import Link from "next/link";
import { XMark } from "@/components/x/XMark";
import { cn } from "@/lib/utils";

export type SettingsTabId = "general" | "reddit" | "x";

const TABS: { id: SettingsTabId; label: string; path: string; mark?: string }[] = [
  { id: "general", label: "General", path: "/app/settings" },
  { id: "reddit", label: "Reddit", path: "/app/settings/scanning", mark: "/brands/reddit.svg" },
  { id: "x", label: "X", path: "/app/settings/x" },
];

/**
 * Settings' own tabs: what every platform shares, then one per platform, each
 * saying how often it checks, what upgrading changes and what it costs. X is
 * there only for users X leads is on for. Links, drawn as PillTabs are, so
 * each tab is its own page and keeps the project in the URL.
 */
export function SettingsTabs({ active, showX, project }: { active: SettingsTabId; showX: boolean; project?: string }) {
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  return (
    <nav aria-label="Settings" className="inline-flex gap-1 self-start rounded-control bg-surface-2 p-1">
      {TABS.filter((tab) => tab.id !== "x" || showX).map((tab) => (
        <Link
          key={tab.id}
          href={`${tab.path}${query}`}
          aria-current={tab.id === active ? "page" : undefined}
          className={cn(
            "transition-motion inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-small transition-colors",
            tab.id === active ? "border bg-surface text-fg" : "border border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {tab.id === "x" ? (
            // X's mark in the text colour: its brand file is black, lost on the dark theme.
            <XMark className="size-3.5" aria-hidden="true" />
          ) : tab.mark ? (
            // Brand art from public/brands; no image proxy needed.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tab.mark} alt="" width={14} height={14} />
          ) : null}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
