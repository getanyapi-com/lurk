import { CalendarDays, Filter } from "lucide-react";
import { FilterPills, type FilterSpec } from "@/components/FilterPills";

const ICON = "size-3.5 shrink-0 text-fg-muted";

/** The pills over the X feed, in the Leads tab's own words and icons: when, and what state. */
export function XFilters({ days, status }: { days: string; status: string }) {
  const filters: FilterSpec[] = [
    {
      name: "days",
      ariaLabel: "days",
      icon: <CalendarDays className={ICON} aria-hidden="true" />,
      fallback: days,
      options: [
        { value: "1", label: "Today" },
        { value: "7", label: "7 days" },
        { value: "30", label: "30 days" },
      ],
    },
    {
      name: "status",
      ariaLabel: "status",
      icon: <Filter className={ICON} aria-hidden="true" />,
      fallback: status,
      options: [
        { value: "new", label: "New" },
        { value: "replied", label: "Replied" },
        { value: "hidden", label: "Hidden" },
        { value: "not_fit", label: "Not a fit" },
      ],
    },
  ];
  return <FilterPills filters={filters} />;
}
