import { ArrowUpRight } from "lucide-react";
import { ANYAPI_URL } from "@/lib/brand";
import { ANYAPI_PLATFORMS } from "@/lib/anyapiCatalog";
import { BrandImage } from "./marketing/BrandImage";
import { AnyapiMark } from "./AnyapiMark";

/**
 * The quiet standing ad at the foot of the rail: the platforms beyond Reddit
 * that the same AnyAPI key reads. One link, no dismiss, no motion.
 */
export function AnyapiRailCard() {
  return (
    <a
      href={ANYAPI_URL}
      target="_blank"
      rel="noopener"
      className="transition-motion group mt-auto flex flex-col gap-2 rounded-card border p-3 text-small text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <span className="flex items-center -space-x-1">
        {ANYAPI_PLATFORMS.slice(1, 7).map((platform) => (
          <span key={platform.name} className="flex rounded-full bg-bg p-0.5 ring-1 ring-border">
            <BrandImage
              name={platform.name}
              domain={"domain" in platform ? platform.domain : undefined}
              size={14}
            />
          </span>
        ))}
      </span>
      <span>Need data from TikTok, LinkedIn or Amazon?</span>
      <span className="flex items-center gap-1 text-fg">
        <AnyapiMark size={14} />
        Use AnyAPI
        <ArrowUpRight className="size-3.5 opacity-60" aria-hidden="true" />
      </span>
    </a>
  );
}
