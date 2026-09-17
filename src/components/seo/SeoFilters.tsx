import { ArrowDownWideNarrow, Hash, LayoutGrid, Lock, Search, Users } from "lucide-react";
import { FilterPills, type FilterSpec } from "@/components/FilterPills";
import type { SeoFacets } from "@/lib/seo/read";
import { DEFAULT_ORDER, DEFAULT_VIEW, SEO_ORDERS, SEO_VIEWS } from "@/lib/seo/views";

type SeoFiltersProps = { facets: SeoFacets };

const ICON = "size-3.5 shrink-0 text-fg-muted";

/**
 * Pick how the rankings are drawn and what they are ordered by, narrow them to
 * one phrasing, one community or the ones a rival is in, and choose whether to
 * see the threads nobody can reply in.
 *
 * The view and the order lead, because they are what the tab was missing: it
 * had one shape and one order, and the order was the alphabet.
 */
export function SeoFilters({ facets }: SeoFiltersProps) {
  const filters: FilterSpec[] = [
    {
      name: "view",
      ariaLabel: "view",
      icon: <LayoutGrid className={ICON} aria-hidden="true" />,
      fallback: DEFAULT_VIEW,
      options: SEO_VIEWS.map((view) => ({ value: view.id, label: view.label })),
    },
    {
      name: "order",
      ariaLabel: "order",
      icon: <ArrowDownWideNarrow className={ICON} aria-hidden="true" />,
      fallback: DEFAULT_ORDER,
      options: SEO_ORDERS.map((order) => ({ value: order.id, label: order.label })),
    },
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
