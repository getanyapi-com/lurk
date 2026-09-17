"use client";

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The thread's own title, linking out to Reddit from inside a row that opens on
 * click. Two reasons it is a client component: the click has to stop where it
 * lands, or following the link would also toggle the row's detail, and a server
 * component cannot carry a handler that says so.
 *
 * The arrow is not decoration. Every other click in this table opens something
 * in place; this one leaves the app, and the only honest way to say so before
 * the click is to mark it.
 */
export function ThreadLink({
  href,
  title,
  className,
  strong = false,
}: {
  href: string;
  title: string;
  className: string;
  /** The app writes its medium weight inline everywhere; this carries it in. */
  strong?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cn("group/out inline hover:underline", className)}
      style={strong ? { fontWeight: 500 } : undefined}
      title="Opens on Reddit in a new tab"
    >
      {title}
      <ArrowUpRight
        className="mb-0.5 ml-0.5 inline size-3.5 shrink-0 align-middle text-fg-muted group-hover/out:text-fg"
        aria-label="opens in a new tab"
      />
    </a>
  );
}
