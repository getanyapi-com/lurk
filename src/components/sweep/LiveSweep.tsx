"use client";

import { useEffect, useState } from "react";
import { sweepAction } from "@/app/app/leads/actions";
import { SweepBoard } from "@/components/sweep/SweepBoard";
import type { SweepSnapshot } from "@/lib/sweep";

/** A second is as often as the sweep has anything new to say. */
const POLL_MS = 1000;

/**
 * The board over a real sweep: reads it once a second until it has ended, and
 * leaves the last state drawn. It can be put away, because what a person came
 * for is the feed underneath it.
 */
export function LiveSweep({ projectId, first }: { projectId: string; first: SweepSnapshot }) {
  const [snapshot, setSnapshot] = useState(first);
  const [hidden, setHidden] = useState(false);
  const ended = snapshot.state === "done" || snapshot.state === "stopped";

  useEffect(() => {
    if (ended || hidden) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await sweepAction(projectId);
        if (!stopped && next) {
          setSnapshot(next);
        }
      } catch {
        // A read that fails is asked again; the sweep itself is not affected.
      }
      if (!stopped) {
        timer = setTimeout(read, POLL_MS);
      }
    };
    timer = setTimeout(read, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [projectId, ended, hidden]);

  if (hidden) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <SweepBoard snapshot={snapshot} />
      {ended ? (
        <button type="button" className="self-end text-small text-fg-muted underline" onClick={() => setHidden(true)}>
          Hide this
        </button>
      ) : null}
    </div>
  );
}
