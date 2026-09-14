"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SearchSelect } from "@/components/ui/searchSelect";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FilterSpec = {
  /** The search parameter this pill owns. */
  name: string;
  icon: React.ReactNode;
  ariaLabel: string;
  /** What the pill reads as when the URL says nothing about this filter. */
  fallback: string;
  options: SelectOption[];
  /**
   * Whether the option list needs a search box. Set it for the lists that grow
   * with the project - the communities a scan finds, the phrasings discovery
   * writes - and leave it off for a fixed handful like a window or a status,
   * where a search box is one more thing to read past.
   */
  searchable?: boolean;
  /** What that search box says before anything is typed. */
  searchPlaceholder?: string;
};

/**
 * The row of filter pills over a feed, shared by every feed that has one.
 *
 * Narrowing a feed re-renders the page on the server, which takes about a
 * second against a real project. The transition is what makes that second
 * legible: the pill that changed says it is working and the row dims, rather
 * than the page sitting on the old answer with nothing moving.
 */
export function FilterPills({ filters }: { filters: FilterSpec[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
    startTransition(() => router.push(`?${next.toString()}`));
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 transition-opacity",
        pending && "opacity-60",
      )}
      aria-busy={pending}
    >
      {filters.map((filter) => (
        <span
          key={filter.name}
          className="text-small inline-flex items-center gap-1.5 rounded-control border bg-surface py-1 pr-1 pl-2.5 text-fg-muted"
        >
          {pending ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-muted" aria-hidden="true" />
          ) : (
            filter.icon
          )}
          {filter.searchable ? (
            <SearchSelect
              shape="pill"
              ariaLabel={filter.ariaLabel}
              searchPlaceholder={filter.searchPlaceholder}
              value={params.get(filter.name) ?? filter.fallback}
              options={filter.options}
              onValueChange={(value) => select(filter.name, value)}
            />
          ) : (
            <Select
              shape="pill"
              ariaLabel={filter.ariaLabel}
              value={params.get(filter.name) ?? filter.fallback}
              options={filter.options}
              onValueChange={(value) => select(filter.name, value)}
            />
          )}
        </span>
      ))}
    </div>
  );
}
