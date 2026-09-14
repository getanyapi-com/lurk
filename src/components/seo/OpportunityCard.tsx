import { ArrowUp, MessageCircle } from "lucide-react";
import { SubredditChip } from "@/components/SubredditChip";
import type { Relevance } from "@/lib/discovery/label";
import { relativeAge } from "@/lib/format";
import { GoogleRankBadge } from "@/components/seo/GoogleRankBadge";

export type RankingThread = {
  id: string;
  position: number | null;
  competitorPresent: boolean;
  /** What this project judged the thread to hold, or null if nothing has. */
  verdict: Relevance | null;
  title: string;
  url: string;
  subreddit: string;
  subredditIconUrl: string | null;
  score: number | null;
  numComments: number | null;
  createdAt: Date;
};

/**
 * What a verdict says on the card. A thread nobody has judged says nothing:
 * an unread thread is not a rejected one, and the page orders it that way.
 */
const VERDICT_WORDS: Partial<Record<Relevance, string>> = {
  relevant: "Someone asking",
  plausible: "Maybe asking",
  irrelevant: "Nobody asking",
};

type OpportunityCardProps = { thread: RankingThread };

function Count({ icon, value }: { icon: React.ReactNode; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-mono tabular-nums text-fg-muted">
      {icon}
      {value ?? "-"}
    </span>
  );
}

/** One Reddit thread Google ranks for a keyword. */
export function OpportunityCard({ thread }: OpportunityCardProps) {
  const iconClass = "size-3.5 shrink-0";
  return (
    <div className="flex items-start gap-3 rounded-card border bg-surface p-4">
      <GoogleRankBadge position={thread.position} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <a
          href={thread.url}
          target="_blank"
          rel="noreferrer"
          className="text-body text-fg hover:underline"
          style={{ fontWeight: 500 }}
        >
          {thread.title}
        </a>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <SubredditChip name={thread.subreddit} iconUrl={thread.subredditIconUrl} />
          <span className="text-mono text-fg-muted">{relativeAge(thread.createdAt)}</span>
          <Count icon={<ArrowUp className={iconClass} aria-hidden="true" />} value={thread.score} />
          <Count
            icon={<MessageCircle className={iconClass} aria-hidden="true" />}
            value={thread.numComments}
          />
          {thread.verdict && VERDICT_WORDS[thread.verdict] ? (
            <span className="rounded-control border px-2 py-0.5 text-mono text-fg-muted">
              {VERDICT_WORDS[thread.verdict]}
            </span>
          ) : null}
          {thread.competitorPresent ? (
            <span className="rounded-control border px-2 py-0.5 text-mono text-fg">
              Competitor named
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
