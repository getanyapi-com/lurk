import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";

type SubredditChipProps = { name: string; iconUrl?: string | null; className?: string };

/** The "r/" disc Reddit shows for a community with no icon of its own. */
export const SUBREDDIT_FALLBACK_ICON = "/brands/subreddit-default.svg";

/** "r/SaaS" with the community's own icon, or the "r/" disc Reddit shows when it has none. */
export function SubredditChip({ name, iconUrl, className }: SubredditChipProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-mono text-fg-muted", className)}>
      <Avatar name={name} src={iconUrl || SUBREDDIT_FALLBACK_ICON} size={16} />
      r/{name}
    </span>
  );
}
