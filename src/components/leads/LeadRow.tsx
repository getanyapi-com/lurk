import { AuthorAvatar } from "@/components/AuthorAvatar";
import { RowLink } from "@/components/leads/RowLink";
import { SubredditChip } from "@/components/SubredditChip";
import { shortAge } from "@/lib/format";

type LeadRowProps = {
  /** The entry id in the URL, which is also what the pane opens on. */
  id: string;
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
 *
 * Everything on this row is also everything the pane needs to open, so the row
 * hands it over on the click rather than making the pane wait to be told.
 */
export function LeadRow({
  id,
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
    <RowLink
      href={href}
      selectedOnServer={selected}
      summary={{ id, title, author, avatarUrl, subreddit, subredditIconUrl, createdAt, trailing }}
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
      <span className="shrink-0 pt-0.5">{trailing}</span>
    </RowLink>
  );
}
