import { CalendarDays, Filter, Hash, Target } from "lucide-react";
import { FilterPills, type FilterSpec } from "@/components/FilterPills";
import { FEED_WINDOWS, type FeedFacets } from "@/lib/feed";

type FeedFiltersProps = { facets: FeedFacets };

const WINDOW_LABELS: Record<string, string> = {
  1: "Today",
  7: "7 days",
  30: "30 days",
  all: "All time",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  hidden: "Hidden",
  not_fit: "Not a fit",
  resolved: "Resolved",
};

function label(stage: string): string {
  return stage.replace(/_/g, " ");
}

const ICON = "size-3.5 shrink-0 text-fg-muted";

/** The row of pills over the feed: when, where, how far along, and what state. */
export function FeedFilters({ facets }: FeedFiltersProps) {
  const filters: FilterSpec[] = [
    {
      name: "days",
      ariaLabel: "days",
      icon: <CalendarDays className={ICON} aria-hidden="true" />,
      fallback: "30",
      options: FEED_WINDOWS.map((days) => ({
        value: String(days),
        label: WINDOW_LABELS[days],
      })),
    },
    {
      name: "subreddit",
      ariaLabel: "subreddit",
      icon: <Hash className={ICON} aria-hidden="true" />,
      fallback: "",
      options: [
        { value: "", label: "All subreddits" },
        ...facets.subreddits.map((name) => ({ value: name.toLowerCase(), label: `r/${name}` })),
      ],
    },
    {
      name: "stage",
      ariaLabel: "stage",
      icon: <Target className={ICON} aria-hidden="true" />,
      fallback: "",
      options: [
        { value: "", label: "Any stage" },
        ...facets.stages.map((stage) => ({ value: stage, label: label(stage) })),
      ],
    },
    {
      name: "status",
      ariaLabel: "status",
      icon: <Filter className={ICON} aria-hidden="true" />,
      fallback: "new",
      options: Object.entries(STATUS_LABELS).map(([value, text]) => ({ value, label: text })),
    },
  ];
  return <FilterPills filters={filters} />;
}
