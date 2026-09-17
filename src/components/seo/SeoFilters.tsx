import { ArrowDownWideNarrow, Hash, Lock, Search, Users } from "lucide-react";
import { FilterPills, type FilterSpec } from "@/components/FilterPills";
import { BY_INTENT, type SeoFacets } from "@/lib/seo/read";

type SeoFiltersProps = { facets: SeoFacets };

const ICON = "size-3.5 shrink-0 text-fg-muted";

/**
 * Narrow the rankings to one phrasing, one community, or the ones a rival is
 * in, choose whether to see the threads nobody can reply in, and pick what the
 * list is ordered by.
 */
export function SeoFilters({ facets }: SeoFiltersProps) {
  const filters: FilterSpec[] = [
    {
      name: "keyword",
      ariaLabel: "keyword",
      icon: <Search className={ICON} aria-hidden="true" />,
      fallback: "",
      searchable: true,
      searchPlaceholder: "reddit scraper",
      options: [
        { value: "", label: "All phrasings" },
        ...facets.keywords.map((keyword) => ({ value: keyword, label: keyword })),
      ],
    },
    {
      name: "subreddit",
      ariaLabel: "subreddit",
      icon: <Hash className={ICON} aria-hidden="true" />,
      fallback: "",
      searchable: true,
      searchPlaceholder: "r/webscraping",
      options: [
        { value: "", label: "All subreddits" },
        ...facets.subreddits.map((name) => ({ value: name.toLowerCase(), label: `r/${name}` })),
      ],
    },
    {
      name: "closed",
      ariaLabel: "closed threads",
      icon: <Lock className={ICON} aria-hidden="true" />,
      fallback: "",
      options: [
        { value: "", label: "Open threads" },
        { value: "yes", label: "Include closed" },
      ],
    },
    {
      name: "sort",
      ariaLabel: "order",
      icon: <ArrowDownWideNarrow className={ICON} aria-hidden="true" />,
      fallback: "",
      options: [
        { value: "", label: "Best to reply in" },
        { value: BY_INTENT, label: "By buyer intent" },
      ],
    },
    {
      name: "competitor",
      ariaLabel: "competitor",
      icon: <Users className={ICON} aria-hidden="true" />,
      fallback: "",
      options: [
        { value: "", label: "Any thread" },
        { value: "yes", label: "Competitor named" },
        { value: "no", label: "No competitor named" },
      ],
    },
  ];
  return <FilterPills filters={filters} />;
}
