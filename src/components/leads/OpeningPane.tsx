"use client";

import { AuthorAvatar } from "@/components/AuthorAvatar";
import { SubredditChip } from "@/components/SubredditChip";
import { Skeleton } from "@/components/Skeleton";
import { relativeAge } from "@/lib/format";

import type { OpeningSummary } from "@/components/leads/opening";

/**
 * The thread, opened on what the list already knew.
 *
 * The heading is real from the first frame - the title, who wrote it, where,
 * how old, and its rating are all on the row that was clicked - and only the
 * parts nobody has read yet stand in as blocks. It is the same pane the server
 * sends a moment later, so nothing jumps when it arrives.
 */
export function OpeningPane({ summary }: { summary: OpeningSummary }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <header className="flex flex-col gap-2 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-h3 text-fg" style={{ fontWeight: 500 }}>
            {summary.title}
          </h3>
          <span className="shrink-0 pt-1">{summary.trailing}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AuthorAvatar name={summary.author} src={summary.avatarUrl} size={24} />
          <span className="text-small text-fg-muted">u/{summary.author ?? "unknown"}</span>
          <SubredditChip name={summary.subreddit} iconUrl={summary.subredditIconUrl} />
          <span className="text-mono text-fg-muted">{relativeAge(summary.createdAt)}</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 xl:flex-row">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-1">
          <div className="flex flex-col gap-2 rounded-card bg-surface-2 p-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="flex shrink-0 flex-col gap-3 xl:w-52">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    </div>
  );
}
