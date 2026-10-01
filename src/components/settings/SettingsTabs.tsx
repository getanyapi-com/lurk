import { PillLinkTabs } from "@/components/PillLinkTabs";
import { XMark } from "@/components/x/XMark";

export type SettingsTabId = "general" | "reddit" | "x";

const TABS: { id: SettingsTabId; label: string; path: string; mark?: string; icon?: React.ReactNode }[] = [
  { id: "general", label: "General", path: "/app/settings" },
  { id: "reddit", label: "Reddit", path: "/app/settings/scanning", mark: "/brands/reddit.svg" },
  // X's mark in the text colour: its brand file is black, lost on the dark theme.
  { id: "x", label: "X", path: "/app/settings/x", icon: <XMark className="size-3.5" aria-hidden="true" /> },
];

/**
 * Settings' own tabs: what every platform shares, then one per platform, each
 * saying how often it checks, what upgrading changes and what it costs. X is
 * there only for users X leads is on for. Links, so each tab is its own page
 * and keeps the project in the URL.
 */
export function SettingsTabs({ active, showX, project }: { active: SettingsTabId; showX: boolean; project?: string }) {
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  return (
    <PillLinkTabs
      label="Settings"
      className="self-start"
      activeId={active}
      tabs={TABS.filter((tab) => tab.id !== "x" || showX).map((tab) => ({ ...tab, href: `${tab.path}${query}` }))}
    />
  );
}
