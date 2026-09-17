"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moreLeadsAction } from "@/app/app/leads/actions";
import { LeadRow } from "@/components/leads/LeadRow";
import { entryHref } from "@/components/leads/workspace";
import { Skeleton } from "@/components/Skeleton";
import { VerdictBadge } from "@/components/VerdictBadge";
import type { FeedRow } from "@/lib/feed";

type LeadPagesProps = {
  projectId: string;
  /** The filters this list is showing, as the URL spells them. */
  search: string;
  /** How many rows the server drew, which is where the next page starts. */
  drawn: number;
  /** Every lead these filters hold, so the list knows when it is whole. */
  total: number;
  selectedId: string | null;
  /** The first page, drawn on the server. */
  children: React.ReactNode;
};

/**
 * The rest of the feed, a page at a time as the list is scrolled.
 *
 * The server draws the first page and stops, because a project with a year of
 * backfill behind it holds hundreds of leads and reading and drawing all of
 * them is the whole of the wait before anything appears. Everything after that
 * is fetched when the foot of the list comes into view, so the wait is one page
 * long however many leads there are.
 */
export function LeadPages({
  projectId,
  search,
  drawn,
  total,
  selectedId,
  children,
}: LeadPagesProps) {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [failed, setFailed] = useState(false);
  const foot = useRef<HTMLDivElement | null>(null);
  const fetching = useRef(false);
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
  const shown = drawn + rows.length;
  const whole = shown >= total;

  const more = useCallback(async () => {
    if (fetching.current) {
      return;
    }
    fetching.current = true;
    setFailed(false);
    try {
      const next = await moreLeadsAction(projectId, search, shown);
      setRows((before) => [...before, ...next]);
    } catch {
      setFailed(true);
    } finally {
      fetching.current = false;
    }
  }, [projectId, search, shown]);

  useEffect(() => {
    const mark = foot.current;
    if (!mark || whole || failed) {
      return;
    }
    // The list column is its own scroller, so the foot only meets the viewport
    // once the rows above it have been read.
    const watch = new IntersectionObserver((seen) => {
      if (seen.some((one) => one.isIntersecting)) {
        void more();
      }
    });
    watch.observe(mark);
    return () => watch.disconnect();
  }, [failed, more, whole]);

  return (
    <>
      {children}
      {rows.map((row) => (
        <LeadRow
          key={row.id}
          id={row.id}
          href={entryHref(params, row.id)}
          selected={row.id === selectedId}
          title={row.title}
          author={row.author}
          avatarUrl={row.avatarUrl}
          subreddit={row.subreddit}
          subredditIconUrl={row.subredditIconUrl}
          createdAt={row.createdAt}
          trailing={<VerdictBadge fit={row.fit} intent={row.intent} />}
        />
      ))}
      {whole ? null : (
        <div ref={foot} className="flex items-center gap-2.5 border-t px-3 py-2.5">
          {failed ? (
            <button type="button" className="text-small text-fg-muted underline" onClick={more}>
              {`Could not read the other ${total - shown}. Try again`}
            </button>
          ) : (
            <>
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-full max-w-64" />
                <Skeleton className="h-3 w-32" />
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
