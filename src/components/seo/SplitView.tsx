import Link from "next/link";
import { SubredditChip } from "@/components/SubredditChip";
import { InlineScore } from "@/components/seo/OpportunityScore";
import { RankPill } from "@/components/seo/RankPill";
import { ThreadFacts } from "@/components/seo/ThreadFacts";
import { shortAge } from "@/lib/format";
import type { ScoredThread } from "@/lib/seo/score";
import { cn } from "@/lib/utils";

/**
 * Both panes fill the window under the pinned header, inside the page gutter,
 * so the list scrolls against a thread that stays put. The same two tokens the
 * Leads workspace measures itself with, because it is the same shape.
 */
const PANE_HEIGHT = "calc(100dvh - var(--header-height) - var(--page-gutter) * 2)";
const PANE_TOP = "calc(var(--header-height) + var(--page-gutter))";

const COLUMN = "sticky flex flex-col rounded-card border bg-surface";

/**
 * The ranked list and one whole thread, side by side.
 *
 * It is the Leads shape applied to this tab, for the reader who works down a
 * list: every fact about the selected thread is on screen without a click that
 * opens anything, and moving to the next one is a single keystroke away. The
 * selection lives in the URL, so a thread worth showing someone is a link.
 */
export function SplitView({
  threads,
  selected,
  hrefFor,
  competitors,
}: {
  threads: ScoredThread[];
  selected: ScoredThread | null;
  /** Where a row goes: this tab with that thread open. */
  hrefFor: (id: string) => string;
  competitors: string[];
}) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
      <div
        className={cn(COLUMN, "overflow-y-auto")}
        style={{ top: PANE_TOP, maxHeight: PANE_HEIGHT }}
      >
        {threads.map((thread) => (
          <Link
            key={thread.id}
            href={hrefFor(thread.id)}
            scroll={false}
            prefetch={false}
            aria-current={thread.id === selected?.id ? "true" : undefined}
            className={cn(
              "transition-motion flex flex-col gap-1.5 border-b px-3 py-2.5 last:border-b-0",
              thread.id === selected?.id ? "bg-surface-2" : "hover:bg-surface-2",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-small text-fg" style={{ fontWeight: 500 }}>
                {thread.title}
              </span>
              <InlineScore scored={thread.scored} />
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <RankPill position={thread.position} />
              <SubredditChip
                name={thread.subreddit}
                iconUrl={thread.subredditIconUrl}
                className="min-w-0 truncate"
              />
              <span className="text-mono shrink-0 text-fg-muted">{shortAge(thread.createdAt)}</span>
            </span>
            <span className="text-mono line-clamp-1 text-fg-muted">{thread.keyword}</span>
          </Link>
        ))}
      </div>
      {selected ? (
        <div
          className={cn(COLUMN, "overflow-y-auto")}
          style={{ top: PANE_TOP, maxHeight: PANE_HEIGHT }}
        >
          {/* The post below carries its own title, the way Reddit shows one, so
              this says only the thing Reddit cannot: which query found it. */}
          <div className="flex items-center gap-2 p-4 pb-0">
            <RankPill position={selected.position} />
            <span className="text-mono text-fg-muted">
              Ranks for &ldquo;{selected.keyword}&rdquo;
            </span>
          </div>
          <ThreadFacts thread={selected} competitors={competitors} />
        </div>
      ) : null}
    </div>
  );
}
