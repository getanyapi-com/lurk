import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SubredditChip } from "@/components/SubredditChip";
import { InlineScore } from "@/components/seo/OpportunityScore";
import { RankPill } from "@/components/seo/RankPill";
import { ThreadFacts } from "@/components/seo/ThreadFacts";
import { shortAge } from "@/lib/format";
import type { ScoredThread } from "@/lib/seo/score";
import { cn } from "@/lib/utils";

/**
 * From lg up, both panes fill the window under the pinned header, inside the
 * page gutter, so the list scrolls against a thread that stays put. The same
 * measure the Leads workspace uses, because it is the same shape.
 */
const PANE =
  "lg:sticky lg:top-[calc(var(--header-height)_+_var(--page-gutter))] lg:max-h-[calc(100dvh_-_var(--header-height)_-_var(--page-gutter)_*_2)]";

const COLUMN = "flex min-w-0 flex-col rounded-card border bg-surface";

/**
 * The ranked list and one whole thread, side by side.
 *
 * It is the Leads shape applied to this tab, for the reader who works down a
 * list: every fact about the selected thread is on screen without a click that
 * opens anything, and moving to the next one is a single keystroke away. The
 * selection lives in the URL, so a thread worth showing someone is a link.
 *
 * Below lg there is room for one pane. The list is the page, and a thread the
 * URL names covers it until Back; the first thread, shown because nothing was
 * asked for, stays out of the way.
 */
export function SplitView({
  threads,
  selected,
  asked,
  backHref,
  hrefFor,
  competitors,
}: {
  threads: ScoredThread[];
  selected: ScoredThread | null;
  /** Whether the URL names the thread, rather than it being the first one. */
  asked: boolean;
  /** This list with no thread named, which is where Back goes. */
  backHref: string;
  /** Where a row goes: this tab with that thread open. */
  hrefFor: (id: string) => string;
  competitors: string[];
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
      <div className={cn(COLUMN, PANE, "lg:overflow-y-auto")}>
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
          className={cn(
            COLUMN,
            PANE,
            "overflow-y-auto max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-[var(--header-height)] max-lg:z-10 max-lg:rounded-none max-lg:border-0",
            asked ? "" : "max-lg:hidden",
          )}
        >
          <Link
            href={backHref}
            scroll={false}
            className="text-small flex shrink-0 items-center gap-1 border-b px-3 py-2.5 text-fg-muted lg:hidden"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to threads
          </Link>
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
