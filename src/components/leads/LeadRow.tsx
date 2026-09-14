import Link from "next/link";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { RowPending } from "@/components/leads/RowPending";
import { SubredditChip } from "@/components/SubredditChip";
import { shortAge } from "@/lib/format";

type LeadRowProps = {
  href: string;
  selected: boolean;
  title: string;
  author: string | null;
  avatarUrl: string | null;
  subreddit: string;
  subredditIconUrl: string | null;
  createdAt: Date;
  /** The one thing the row rates by: a score for a lead, a verdict for a held item. */
  trailing: React.ReactNode;
};

/**
 * One line in the list column. It carries only what picks a row out of eighty:
 * the face, the ask, the community, the age, and one rating. The prose and the
 * judgement bars live in the detail pane, which is where they are read.
 */
export function LeadRow({
  href,
  selected,
  title,
  author,
  avatarUrl,
  subreddit,
  subredditIconUrl,
  createdAt,
  trailing,
}: LeadRowProps) {
  return (
    <Link
      href={href}
      scroll={false}
      // Prefetching a row would read the whole feed again for every row the
      // pointer crosses, and it is the same read the click itself makes.
      prefetch={false}
      aria-current={selected ? "true" : undefined}
      className={`transition-motion relative isolate flex items-start gap-2.5 border-b px-3 py-2.5 last:border-b-0 ${
        selected ? "bg-surface-2" : "hover:bg-surface-2"
      }`}
    >
      <AuthorAvatar name={author} src={avatarUrl} size={24} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-small text-fg" style={{ fontWeight: 500 }}>
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <SubredditChip name={subreddit} iconUrl={subredditIconUrl} className="min-w-0 truncate" />
          <span className="text-mono shrink-0 text-fg-muted">{shortAge(createdAt)}</span>
        </span>
      </span>
      <span className="shrink-0 pt-0.5">
        <RowPending>{trailing}</RowPending>
      </span>
    </Link>
  );
}
