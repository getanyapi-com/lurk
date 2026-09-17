import { Favicon } from "@/components/Favicon";
import { competitorHost } from "@/lib/competitors/host";

type CompetitorChipProps = {
  name: string;
  /** The site discovery paired this name with, when it found one. */
  domain?: string | null;
  count?: number;
};

/**
 * A competitor, wearing its own logo when we know which site it sells from.
 * The name itself is used only when it is already a domain: a name we have no
 * site for wears its initials rather than a favicon guessed off the spelling.
 */
export function CompetitorChip({ name, domain, count }: CompetitorChipProps) {
  return (
    <span className="inline-flex items-center gap-2 rounded-control border bg-surface px-2.5 py-1.5 text-small text-fg">
      <Favicon url={domain ?? competitorHost(name)} name={name} size={20} />
      {name}
      {count === undefined ? null : (
        <span className="tabular-nums text-fg-muted">{count}</span>
      )}
    </span>
  );
}
