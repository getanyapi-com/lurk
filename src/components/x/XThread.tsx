import { ChartNoAxesColumn, Heart, MessageCircle, Repeat2, Search } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { HighlightedBody } from "@/components/leads/HighlightedBody";
import { compactCount } from "@/lib/format";
import type { XThread as XThreadData, XThreadPost } from "@/lib/x/read";

/** A count the way X shows one under a post: 950, 1.2K, 38K, 1.4M; nothing when X never gave it. */
function count(value: number | null): string {
  return value === null || value === 0 ? "" : compactCount(value, { upper: true });
}

/** A post's age as X heads it: 12m and 3h inside a day, then its date. */
function xAge(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The focused post's full stamp, as X writes it: 3:42 PM · Sep 27, 2026. */
function stamp(date: Date): string {
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${time} · ${day}`;
}

/** X's own blue badge: the check is cut out of it, so the page shows through in light and dark alike. */
function Verified({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <svg viewBox="0 0 22 22" className="size-[1.2em] shrink-0 fill-[#1d9bf0]" role="img" aria-label="Verified account">
      <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
    </svg>
  );
}

function Handles({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 2);
  const rest = names.length - shown.length;
  return (
    <p className="text-small text-fg-muted">
      Replying to{" "}
      {shown.map((name, index) => (
        <span key={name}>
          {index > 0 ? (rest > 0 ? ", " : " and ") : null}
          <span className="text-[#1d9bf0]">@{name}</span>
        </span>
      ))}
      {rest > 0 ? ` and ${rest} other${rest === 1 ? "" : "s"}` : null}
    </p>
  );
}

/** The four counts under a post, spread across it as X lays them out. */
function Actions({ post }: { post: XThreadPost }) {
  const items = [
    { icon: MessageCircle, value: post.replyCount, label: "replies" },
    { icon: Repeat2, value: post.retweetCount, label: "reposts" },
    { icon: Heart, value: post.likeCount, label: "likes" },
    { icon: ChartNoAxesColumn, value: post.viewCount, label: "views" },
  ];
  return (
    <div className="flex max-w-md items-center justify-between pr-6 text-fg-muted">
      {items.map(({ icon: Icon, value, label }) => (
        <span key={label} className="text-small inline-flex items-center gap-1.5 tabular-nums" aria-label={`${value ?? 0} ${label}`}>
          <Icon className="size-[18px]" aria-hidden="true" />
          {count(value)}
        </span>
      ))}
    </div>
  );
}

/**
 * A post in the thread above or below the focused one: face on the left with
 * the line that joins it to the next, name, handle and age on one row.
 */
function ThreadRow({ post, now, joinBelow, context }: { post: XThreadPost; now: Date; joinBelow: boolean; context?: string }) {
  return (
    <article className="flex flex-col gap-1">
      {/* The small line X puts over a post it shows for a reason ("reposted", "Pinned"). */}
      {context ? (
        <span className="text-small flex items-center gap-3 text-fg-muted" style={{ fontWeight: 700 }}>
          <span className="flex w-10 justify-end">
            <Search className="size-4" aria-hidden="true" />
          </span>
          {context}
        </span>
      ) : null}
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <a href={post.url} target="_blank" rel="noreferrer noopener" className="shrink-0">
            <Avatar name={post.authorName ?? post.authorUsername} src={post.authorImage} size={40} />
          </a>
          {joinBelow ? <span className="mt-1 w-0.5 flex-1 bg-border" aria-hidden="true" /> : null}
        </div>
        <div className={`flex min-w-0 flex-1 flex-col gap-1 ${joinBelow ? "pb-4" : ""}`}>
          <div className="flex min-w-0 items-center gap-1 text-small">
            <span className="truncate text-fg" style={{ fontWeight: 700 }}>
              {post.authorName ?? post.authorUsername}
            </span>
            <Verified on={post.authorVerified} />
            <span className="truncate text-fg-muted">@{post.authorUsername}</span>
            <span className="text-fg-muted">·</span>
            <a href={post.url} target="_blank" rel="noreferrer noopener" className="shrink-0 text-fg-muted hover:underline">
              {xAge(post.postedAt, now)}
            </a>
          </div>
          <Handles names={post.replyingTo} />
          <HighlightedBody text={post.text} phrase={null} linkify className="text-body text-fg" />
          <div className="pt-1">
            <Actions post={post} />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The post as X draws a thread opened on it: what it answers above, joined by
 * the thread line, the post itself large with its full stamp and counts, and
 * the reply that led lurk to it underneath.
 */
export function XThread({ thread, quote, now = new Date() }: { thread: XThreadData; quote: string | null; now?: Date }) {
  const { post } = thread;
  return (
    <div className="flex flex-col rounded-card border bg-surface p-4">
      {thread.gap ? (
        <a
          href={thread.above[0]?.url ?? post.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-small mb-3 flex items-center gap-3 text-[#1d9bf0] hover:underline"
        >
          <span className="flex w-10 flex-col items-center gap-0.5" aria-hidden="true">
            <span className="size-1 rounded-full bg-border" />
            <span className="size-1 rounded-full bg-border" />
            <span className="size-1 rounded-full bg-border" />
          </span>
          Show earlier posts on X
        </a>
      ) : null}

      {thread.above.map((parent) => (
        <ThreadRow key={parent.tweetId} post={parent} now={now} joinBelow />
      ))}

      <article className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <a href={post.url} target="_blank" rel="noreferrer noopener" className="shrink-0">
            <Avatar name={post.authorName ?? post.authorUsername} src={post.authorImage} size={40} />
          </a>
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate text-body text-fg" style={{ fontWeight: 700 }}>
                {post.authorName ?? post.authorUsername}
              </span>
              <Verified on={post.authorVerified} />
            </span>
            <span className="truncate text-small text-fg-muted">@{post.authorUsername}</span>
          </div>
        </div>
        {thread.above.length === 0 ? <Handles names={post.replyingTo} /> : null}
        <HighlightedBody text={post.text} phrase={quote} linkify className="text-[17px] leading-6 text-fg" />
        <p className="text-small text-fg-muted">
          <a href={post.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
            {stamp(post.postedAt)}
          </a>
          {post.viewCount ? (
            <>
              {" · "}
              <span className="text-fg" style={{ fontWeight: 700 }}>
                {count(post.viewCount)}
              </span>{" "}
              Views
            </>
          ) : null}
        </p>
        <div className="border-y py-2.5">
          <Actions post={post} />
        </div>
      </article>

      {thread.below ? (
        <div className="pt-3">
          <ThreadRow post={thread.below} now={now} joinBelow={false} context="lurk found this thread through this reply" />
        </div>
      ) : null}
    </div>
  );
}
