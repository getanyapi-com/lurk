import { Hash, Search, Users } from "lucide-react";
import { FilterPills, type FilterSpec } from "@/components/FilterPills";
import type { SeoFacets } from "@/lib/seo/read";

type SeoFiltersProps = { facets: SeoFacets };

const ICON = "size-3.5 shrink-0 text-fg-muted";

/** Narrow the rankings to one phrasing, one community, or the ones a rival is in. */
export function SeoFilters({ facets }: SeoFiltersProps) {
  const filters: FilterSpec[] = [
    {
      name: "keyword",
      ariaLabel: "keyword",
      icon: <Search className={ICON} aria-hidden="true" />,
      fallback: "",
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
      options: [
        { value: "", label: "All subreddits" },
        ...facets.subreddits.map((name) => ({ value: name.toLowerCase(), label: `r/${name}` })),
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
