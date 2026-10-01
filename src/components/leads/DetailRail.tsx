import { ArrowUp, ExternalLink, MessageCircle } from "lucide-react";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { SubredditChip } from "@/components/SubredditChip";
import { PromoPolicyLine } from "@/components/leads/PromoPolicyBadge";
import { Meter } from "@/components/leads/Meter";
import { Block } from "@/components/leads/pane";
import { accountAge } from "@/components/leads/workspace";
import { fullCount, MISSING } from "@/lib/format";
import { judgementSentence } from "@/lib/scan/words";

export type DetailRailProps = {
  /** The project to read a missing self-promotion rule for, or null to leave it unread. */
  projectId: string | null;
  author: string | null;
  avatarUrl: string | null;
  authorKarma: number | null;
  authorCreatedAt: Date | null;
  subreddit: string;
  subredditIconUrl: string | null;
  weeklyActive: number | null;
  promoPolicy: string | null;
  rulesText: string | null;
  points: number | null;
  numComments: number | null;
  url: string;
  fit: number | null;
  intent: number | null;
  engagement: number | null;
  /** The project's competitors named in this thread, post or replies. */
  competitors: string[];
};

/**
 * The ledger beside the post: who is asking, where they asked, what the thread
 * did, and how the scan scored it. The judgement bars sit here rather than on
 * every row, because they answer a question you only ask once you are reading.
 */
export function DetailRail(props: DetailRailProps) {
  return (
    <aside
      // The app's own rail token, so the two rails frame the page at one width,
      // once the pane is wide enough to hold the post beside it.
      className="shrink-0 rounded-card border bg-surface xl:w-[var(--rail-width)] xl:self-start"
    >
      <Block label="Author">
        <span className="flex items-center gap-2">
          <AuthorAvatar name={props.author} src={props.avatarUrl} size={24} />
          <span className="truncate text-small text-fg">u/{props.author ?? MISSING}</span>
        </span>
        <span className="text-mono tabular-nums text-fg-muted">{fullCount(props.authorKarma)} karma</span>
        <span className="text-mono text-fg-muted">{accountAge(props.authorCreatedAt)}</span>
      </Block>

      <Block label="Community">
        <SubredditChip name={props.subreddit} iconUrl={props.subredditIconUrl} />
        <span className="text-mono tabular-nums text-fg-muted">
          {fullCount(props.weeklyActive)} weekly active
        </span>
        <PromoPolicyLine
          projectId={props.projectId}
          subreddit={props.subreddit}
          policy={props.promoPolicy}
          rulesText={props.rulesText}
        />
      </Block>

      <Block label="Thread">
        <span className="text-mono flex items-center gap-3 tabular-nums text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3.5" aria-hidden="true" />
            {fullCount(props.points)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden="true" />
            {fullCount(props.numComments)}
          </span>
        </span>
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-mono inline-flex items-center gap-1 text-fg-muted hover:text-fg"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open on Reddit
        </a>
      </Block>

      {props.competitors.length > 0 ? (
        <Block label="Competitors named">
          <span className="text-small text-fg">{props.competitors.join(", ")}</span>
        </Block>
      ) : null}

      <Block label="How it scored">
        <Meter
          label="Fit"
          value={props.fit}
          hint={judgementSentence(props.fit, null) ?? "Whether your product is what they need"}
        />
        <Meter
          label="Intent"
          value={props.intent}
          hint={judgementSentence(null, props.intent) ?? "How far along they are toward changing it"}
        />
        <Meter
          label="Engagement"
          value={props.engagement}
          hint="How much the thread itself is moving"
        />
      </Block>
    </aside>
  );
}
