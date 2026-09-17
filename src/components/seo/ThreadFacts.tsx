import { ArrowUp, ArrowUpRight, MessageCircle } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { relativeAge, shortAge } from "@/lib/format";
import { fitWord, intentWord, judgementSentence } from "@/lib/scan/words";
import { competitorsNamed } from "@/lib/competitors/match";
import {
  BAND_FILLS,
  BAND_TONES,
  BAND_WORDS,
  PART_LABELS,
  scoreBand,
  scoreSentence,
  type ScoreParts,
  type ScoredThread,
} from "@/lib/seo/score";
import { cn } from "@/lib/utils";

/** Nothing here is estimated, so a fact Reddit never gave reads as a dash. */
const MISSING = "-";

const STEPS = [1, 2, 3, 4];

function tally(value: number | null): string {
  return value === null ? MISSING : value.toLocaleString("en-US");
}

/** One part of the fold: what it measures, then how far it reached. */
function Part({ label, value, fill }: { label: string; value: number; fill: string }) {
  return (
    <span className="flex items-center justify-between gap-2" title={`${label} ${value} of 4`}>
      <span className="text-mono text-fg-muted">{label}</span>
      <span className="flex items-center gap-0.5" aria-label={`${label} ${value} of 4`}>
        {STEPS.map((step) => (
          <span
            key={step}
            className={cn("h-1.5 w-4 rounded-full", step <= value ? fill : "bg-border")}
          />
        ))}
      </span>
    </span>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b p-3 last:border-b-0">
      <span className="text-mono tracking-wide text-fg-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

/** Why a closed thread is closed, which the two flags answer separately. */
function closedSentence(thread: ScoredThread): string {
  if (thread.isArchived && thread.isLocked) {
    return "Archived and locked";
  }
  return thread.isArchived ? "Archived by Reddit" : "Locked by a moderator";
}

/**
 * One ranking thread opened: the post as Reddit would show it on the left, and
 * everything this product measured about it on the right.
 *
 * The left is deliberately not a data panel. It is the community, the person,
 * the title, the text and the counts, in the order and the shape a redditor
 * already reads them in, because the question it answers is "what is actually
 * being said here" and that is a question you answer by reading a post, not by
 * reading fields. The right is the part Reddit could never tell you: what this
 * thread is worth to this product and why.
 *
 * The post is shown whole, the way the Leads pane shows one. The refresh
 * already bought the text; clipping it only sent the reader to Reddit for the
 * rest, which is the trip this panel exists to save.
 */
export function ThreadFacts({
  thread,
  competitors,
}: {
  thread: ScoredThread;
  /** Every competitor this project watches; the ones in this thread are found here. */
  competitors: string[];
}) {
  const band = scoreBand(thread.scored);
  const named = competitorsNamed(competitors, `${thread.title}\n${thread.body ?? ""}`);
  const judgement = [intentWord(thread.intent), fitWord(thread.fit)].filter(Boolean).join(" / ");

  return (
    <div className="grid gap-4 border-l-2 bg-surface-2 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_var(--rail-width)]">
      <div className="flex max-w-3xl flex-col gap-2">
        <article className="flex flex-col gap-2 rounded-card border bg-surface p-4">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-mono text-fg-muted">
            <Avatar
              name={thread.subreddit}
              src={thread.subredditIconUrl || "/brands/reddit.svg"}
              size={20}
            />
            <span className="text-fg" style={{ fontWeight: 500 }}>
              r/{thread.subreddit}
            </span>
            <span aria-hidden="true">&middot;</span>
            <span>u/{thread.author ?? MISSING}</span>
            <span aria-hidden="true">&middot;</span>
            <span>{relativeAge(thread.createdAt)}</span>
            {thread.closed ? (
              <span className="text-reddit">&middot; {closedSentence(thread).toLowerCase()}</span>
            ) : null}
          </header>

          <h4 className="text-h3 text-fg" style={{ fontWeight: 500 }}>
            {thread.title}
          </h4>

          {thread.body ? (
            <p className="text-small whitespace-pre-wrap text-fg">{thread.body}</p>
          ) : (
            <p className="text-small text-fg-muted">A title only, with no text of its own.</p>
          )}

          <footer className="mt-1 flex flex-wrap items-center gap-4 border-t pt-2.5 text-mono text-fg-muted">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <ArrowUp className="size-3.5" aria-hidden="true" />
              {tally(thread.score)}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <MessageCircle className="size-3.5" aria-hidden="true" />
              {tally(thread.numComments)} comments
            </span>
            <a
              href={thread.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 hover:text-fg"
            >
              Open on Reddit
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          </footer>
        </article>

        {thread.snippet ? (
          /* What a searcher reads before clicking. It is Google's summary, not a
           line of the post, so it sits outside the card rather than inside it. */
          <p className="text-mono text-fg-muted">Google shows &ldquo;{thread.snippet}&rdquo;</p>
        ) : null}
      </div>

      <aside className="h-fit rounded-card border bg-surface">
        <Block label="Worth replying in">
          <span className="flex items-baseline gap-1.5" title={scoreSentence(thread.scored)}>
            <span
              className={cn("text-body tabular-nums", BAND_TONES[band])}
              style={{ fontWeight: 500 }}
            >
              {thread.scored.score}
            </span>
            <span className="text-mono text-fg-muted">{BAND_WORDS[band]}</span>
          </span>
          {(Object.keys(PART_LABELS) as (keyof ScoreParts)[]).map((part) => (
            <Part
              key={part}
              label={PART_LABELS[part]}
              value={thread.scored.parts[part]}
              fill={BAND_FILLS[band]}
            />
          ))}
          {/* Whether the rank above is current, which is the one fact here that
              can quietly go stale between refreshes. */}
          <span className="text-mono text-fg-muted">
            Rank checked {relativeAge(thread.refreshedAt)}
          </span>
        </Block>

        <Block label="Who is asking">
          <span
            className="text-small text-fg"
            title={judgementSentence(thread.fit, thread.intent) ?? undefined}
          >
            {judgement || "Nobody has judged them"}
          </span>
          <span className="text-mono tabular-nums text-fg-muted">
            {tally(thread.authorKarma)} karma
            {thread.authorCreatedAt ? `, ${shortAge(thread.authorCreatedAt)} old` : ""}
          </span>
        </Block>

        <Block label="Can you post here">
          <span className="text-mono tabular-nums text-fg-muted">
            {tally(thread.subredditSubscribers)} members
          </span>
          {/* The rules the sentence came from, so a promo policy can be checked. */}
          <span className="text-mono text-fg-muted" title={thread.rulesText ?? undefined}>
            {thread.promoPolicy ?? "Promotion rules unknown"}
          </span>
        </Block>

        {named.length > 0 ? (
          <Block label="Competitors named">
            <span className="text-mono text-score-warm">{named.join(", ")}</span>
          </Block>
        ) : null}
      </aside>
    </div>
  );
}
