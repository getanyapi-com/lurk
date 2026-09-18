import { ArrowUpRight } from "lucide-react";
import { ANYAPI_URL } from "@/lib/brand";
import { AnyapiMark } from "./AnyapiMark";

type AnyapiLinkProps = { children?: React.ReactNode; mark?: boolean; className?: string };

/**
 * The one way out to AnyAPI: mark, name and an arrow that says it leaves the
 * site. It opens a new tab, so a click never costs the reader their place.
 */
export function AnyapiLink({ children = "AnyAPI", mark = true, className }: AnyapiLinkProps) {
  return (
    <a
      href={ANYAPI_URL}
      target="_blank"
      rel="noopener"
      // Joined by hand: tailwind-merge reads text-small as a colour and drops it.
      className={`anyapi-link inline-flex items-center gap-1 whitespace-nowrap align-middle underline-offset-4 hover:underline ${className ?? ""}`}
    >
      {mark ? <AnyapiMark /> : null}
      {children}
      <ArrowUpRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </a>
  );
}
