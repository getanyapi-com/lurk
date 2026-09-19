"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { scoreRing } from "@/components/leads/stream";
import { cn } from "@/lib/utils";
import { redditAvatar } from "@/lib/redditAvatar";
import type { LeadFace } from "@/lib/feed";

/** A face's side, and the room between two, in pixels. */
const FACE = 24;
const GAP = 2;
/** Rows one column stacks, which is what holds the strip's height still. */
const ROWS = 2;

/**
 * One strip column's faces, as many across as the column is wide. A month in
 * an all-time strip is a hundred pixels and more, and stacking two faces in a
 * line down its middle left most of it empty while a "+10" stood for the rest.
 * So the column is measured, and it holds two rows of however many fit; only
 * what is left over becomes a count, in the last slot.
 *
 * Before it is measured it draws one across, which is what a thirty-day strip
 * on a laptop has room for anyway.
 */
export function FaceStack({ faces }: { faces: LeadFace[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const across = Math.max(1, Math.floor((width + GAP) / (FACE + GAP)));
  // A column thinner than a face shrinks its faces to fit rather than overflow.
  const side = width > 0 && width < FACE ? width : FACE;
  const room = across * ROWS;
  const over = faces.length > room;
  const shown = over ? faces.slice(0, room - 1) : faces;

  return (
    <div
      ref={box}
      // wrap-reverse fills from the baseline up, so the best lead, which comes
      // first, sits on the axis and the rest build upward from it.
      className="flex w-full flex-wrap-reverse content-start justify-center"
      style={{ gap: GAP }}
    >
      {faces.length === 0 ? (
        // A quiet slice still takes up its room, and says so: the dot is a
        // face's box, so it sits on the middle of the baseline.
        <span className="flex items-center justify-center" style={{ width: side, height: side }}>
          <span className="size-1 rounded-full bg-border" />
        </span>
      ) : null}
      {shown.map((face) => (
        <span
          key={face.id}
          className={cn("shrink-0 rounded-full", scoreRing(face.score))}
          style={{ width: side, height: side }}
          title={`u/${face.author ?? "unknown"} in r/${face.subreddit}`}
        >
          <Avatar name={face.author} src={redditAvatar(face.author, face.avatarUrl)} size="fluid" />
        </span>
      ))}
      {over ? (
        <span
          className="flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] tabular-nums text-fg-muted"
          style={{ width: side, height: side }}
        >
          {side >= 20 ? `+${faces.length - shown.length}` : null}
        </span>
      ) : null}
    </div>
  );
}
