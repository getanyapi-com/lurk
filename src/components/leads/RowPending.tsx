"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

/**
 * What a row shows between the click and the thread arriving.
 *
 * Opening a lead is a new read on the server, about a second against a real
 * project, and the detail pane holds the thread you were on until it lands.
 * Without this the click had nothing to show for itself at all. It has to sit
 * inside the row's own Link, which is the only place Next will tell you that
 * this link is the one being waited on.
 */
export function RowPending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  if (!pending) {
    return children;
  }
  return (
    <>
      {/*
        The row takes the selected tint the moment it is clicked, behind its own
        contents, so the answer to "did that land" is the row you clicked rather
        than the pane you are waiting on.
      */}
      <span className="absolute inset-0 -z-10 bg-surface-2" aria-hidden="true" />
      <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-label="Opening" />
    </>
  );
}
