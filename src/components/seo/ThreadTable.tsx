import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ExpandableRow } from "@/components/seo/ExpandableRow";
import { InlineScore } from "@/components/seo/OpportunityScore";
import { RankPill } from "@/components/seo/RankPill";
import { ThreadFacts } from "@/components/seo/ThreadFacts";
import { ThreadLink } from "@/components/seo/ThreadLink";
import { ThreadStatus } from "@/components/seo/ThreadStatus";
import { relativeAge } from "@/lib/format";
import type { ScoredThread } from "@/lib/seo/score";
import type { SeoOrder } from "@/lib/seo/views";
import { cn } from "@/lib/utils";

/**
 * The columns, and which order each one stands for. Four of them are sortable
 * because four orders exist; a column the tab cannot sort by is not dressed up
 * as one that can.
 *
 * Upvotes, replies and how the model read the person asking are not columns.
 * They are parts of the one number this table leads with, and all of them are
 * in the row's own detail, a click down. A table you have to read sideways is
 * the thing this view exists to avoid.
 *
 * The rank and the query are one column because they are one fact: a position
 * means nothing until you know what it is a position for, and reading them in
 * two columns meant reading the same row twice. The column can still be sorted
 * either way, so its heading is the two words rather than a name for the pair.
 */
type Column = {
  label: string;
  /** Every order this column can be read in, in the heading's own order. */
  sorts?: { label: string; order: SeoOrder }[];
  align?: string;
  width?: string;
};

const COLUMNS: Column[] = [
  { label: "Worth", sorts: [{ label: "Worth", order: "score" }], width: "w-32" },
  {
    label: "SEO rank",
    sorts: [
      { label: "SEO rank", order: "google" },
      { label: "query", order: "alpha" },
    ],
    width: "w-80",
  },
  { label: "Thread" },
  { label: "Subreddit", width: "w-44" },
  { label: "Posted", align: "text-right", width: "w-24" },
];

function Head({
  column,
  order,
  hrefFor,
}: {
  column: Column;
  order: SeoOrder;
  hrefFor: (order: SeoOrder) => string;
}) {
  return (
    <th
      scope="col"
      aria-sort={column.sorts?.some((sort) => sort.order === order) ? "descending" : undefined}
      className={cn(
        "border-b px-3 pb-3 text-left text-small font-normal whitespace-nowrap text-fg-muted",
        column.align,
        column.width,
      )}
    >
      {column.sorts
        ? column.sorts.map((sort, index) => (
            <span key={sort.order}>
              {index > 0 ? <span className="px-1 text-fg-muted">&middot;</span> : null}
              <Link
                href={hrefFor(sort.order)}
                scroll={false}
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap hover:text-fg",
                  sort.order === order && "text-fg",
                )}
              >
                {sort.label}
                {sort.order === order ? (
                  <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
                ) : null}
              </Link>
            </span>
          ))
        : column.label}
    </th>
  );
}

/**
 * Every ranking thread this project holds as one table.
 *
 * It is the view for the question the card list answers badly: which of these
 * ninety threads is the best one, whichever phrasing found it. The phrasing is
 * a column here rather than a heading, so nothing is grouped and everything is
 * comparable straight down. No frame around it and no rules between the
 * columns: the rows are the only lines, which is what lets a long list be read
 * quickly.
 */
export function ThreadTable({
  threads,
  order,
  hrefFor,
  competitors,
}: {
  threads: ScoredThread[];
  order: SeoOrder;
  hrefFor: (order: SeoOrder) => string;
  competitors: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <Head key={column.label} column={column} order={order} hrefFor={hrefFor} />
            ))}
            <th scope="col" className="w-8 border-b" />
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => (
            <ExpandableRow
              key={thread.id}
              span={COLUMNS.length}
              label={thread.title}
              detail={<ThreadFacts thread={thread} competitors={competitors} />}
              cells={
                <>
                  <td className="px-3 py-3.5 align-top whitespace-nowrap">
                    <InlineScore scored={thread.scored} />
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <span className="flex items-start gap-2">
                      <RankPill position={thread.position} />
                      <span className="text-small text-fg-muted">{thread.keyword}</span>
                    </span>
                  </td>
                  <td className="max-w-[26rem] px-3 py-3.5 align-top">
                    <ThreadLink
                      href={thread.url}
                      title={thread.title}
                      strong
                      /* A closed thread keeps its place and loses its weight:
                         it still says what ranks, and it is not somewhere to go. */
                      className={cn(
                        "text-small",
                        thread.closed ? "text-fg-muted" : "text-fg",
                      )}
                    />
                    <ThreadStatus thread={thread} competitors={competitors} />
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-small text-fg-muted">
                      <Avatar
                        name={thread.subreddit}
                        src={thread.subredditIconUrl || "/brands/reddit.svg"}
                        size={16}
                      />
                      <span className="truncate">{thread.subreddit}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-right align-top text-small whitespace-nowrap text-fg-muted">
                    {relativeAge(thread.createdAt)}
                  </td>
                </>
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
