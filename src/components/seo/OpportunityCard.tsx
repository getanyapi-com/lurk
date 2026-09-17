import { ArrowUp, MessageCircle } from "lucide-react";
import { SubredditChip } from "@/components/SubredditChip";
import type { Relevance } from "@/lib/discovery/label";
import { relativeAge } from "@/lib/format";
import { fitWord, intentWord, judgementSentence } from "@/lib/scan/words";
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
  /** Archived by Reddit or locked by a moderator: nobody can reply in it. */
  closed: boolean;
  /** What this project judged the person posting, or null if it never has. */
  fit: number | null;
  intent: number | null;
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

/** Why a closed thread is marked rather than only hidden. */
const CLOSED_SENTENCE = "Archived or locked, so nobody can reply in it";

type OpportunityCardProps = {
  thread: RankingThread;
  /** The intent-ordered view says what it ordered on; the default one does not. */
  showJudgement?: boolean;
};

/** A small mono chip, the same one the verdict and the competitor mark use. */
function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="rounded-control border px-2 py-0.5 text-mono text-fg-muted" title={title}>
      {children}
    </span>
  );
}

function Count({ icon, value }: { icon: React.ReactNode; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-mono tabular-nums text-fg-muted">
      {icon}
      {value ?? "-"}
    </span>
  );
}

/** One Reddit thread Google ranks for a keyword. */
export function OpportunityCard({ thread, showJudgement = false }: OpportunityCardProps) {
  const iconClass = "size-3.5 shrink-0";
  const fit = fitWord(thread.fit);
  const intent = intentWord(thread.intent);
  const sentence = judgementSentence(thread.fit, thread.intent) ?? undefined;
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
          {showJudgement ? (
            <>
              <Chip title={sentence}>{fit ?? "Not judged"}</Chip>
              {intent ? <Chip title={sentence}>{intent}</Chip> : null}
            </>
          ) : thread.verdict && VERDICT_WORDS[thread.verdict] ? (
            <Chip>{VERDICT_WORDS[thread.verdict]}</Chip>
          ) : null}
          {thread.closed ? <Chip title={CLOSED_SENTENCE}>Closed</Chip> : null}
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
