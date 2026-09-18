"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
/** How long a finished sweep keeps its board open before it folds away over the leads. */
const FOLD_AFTER_MS = 4000;

/**
 * What a new project is doing before the sweep has a thread to draw, as a log
 * of each thing it finishes. The board is kept back until then: a pile, a sieve
 * and a wall with nothing in them read as a page that had stopped, for the
 * half minute the site read and Google take.
 */
function SweepSetup({ lines }: { lines: string[] }) {
  const shown = lines.length > 0 ? lines : ["Starting"];
  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface px-6 py-5" aria-live="polite">
      <span className="text-[11px] uppercase tracking-wide text-fg-muted">Setting up your project</span>
      <ol className="flex flex-col gap-2">
        {shown.map((line, index) => {
          const now = index === shown.length - 1;
          return (
            <li key={line} className="flex items-center gap-3 text-body" style={{ opacity: now ? 1 : 0.6 }}>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  background: now ? "var(--score-warm)" : "var(--score-hot)",
                  animation: now ? "sweepSetupPulse 1.2s ease-in-out infinite" : undefined,
                }}
              />
              <span className={now ? "text-fg" : "text-fg-muted"}>
                {line}
                {now ? "…" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <style>{"@keyframes sweepSetupPulse { 0% { opacity: 0.35; } 50% { opacity: 1; } 100% { opacity: 0.35; } }"}</style>
    </section>
  );
}

/** A finished sweep in one line, over the leads it found. */
function SweepSummary({ snapshot, onOpen }: { snapshot: SweepSnapshot; onOpen: () => void }) {
  const { counts } = snapshot;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border bg-surface px-4 py-2.5 text-small text-fg-muted">
      <span>
        {snapshot.state === "stopped" ? "The sweep stopped early. " : ""}
        Read <span className="tabular-nums text-fg">{counts.found.toLocaleString()}</span> threads from the past year in{" "}
        <span className="tabular-nums text-fg">{(snapshot.elapsedMs / 1000).toFixed(1)} s</span> ·{" "}
        <span className="tabular-nums text-fg">{snapshot.feedLeads}</span> {snapshot.feedLeads === 1 ? "lead" : "leads"} ·{" "}
        <span className="tabular-nums text-fg">{counts.review}</span> held for review
      </span>
      <button type="button" className="underline" onClick={onOpen}>
        Show the sweep
      </button>
    </div>
  );
}

export function LiveSweep({ projectId, first }: { projectId: string; first: SweepSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(first);
  const ended = snapshot.state === "done" || snapshot.state === "stopped";
  // A sweep that was already over when the page loaded opens folded: the leads
  // are what the page is for, and the board is one click away.
  const [folded, setFolded] = useState(first.state === "done" || first.state === "stopped");
  const [lines, setLines] = useState<string[]>(first.progress ? [first.progress] : []);
  const wasEnded = useRef(ended);
  const setup = !ended && snapshot.counts.found === 0;

  // The moment it ends, the feed under it is read again, so the leads it found
  // are on the page, and a few seconds later the board folds out of their way.
  useEffect(() => {
    if (!ended || wasEnded.current) {
      return;
    }
    wasEnded.current = true;
    router.refresh();
    const timer = setTimeout(() => setFolded(true), FOLD_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ended, router]);

  useEffect(() => {
    if (ended) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await sweepAction(projectId);
        if (!stopped && next) {
          setSnapshot(next);
          const line = next.progress;
          if (line && next.counts.found === 0) {
            setLines((seen) => (seen.includes(line) ? seen : [...seen, line]));
          }
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
  }, [projectId, ended]);

  if (setup) {
    return <SweepSetup lines={lines} />;
  }
  if (folded) {
    return <SweepSummary snapshot={snapshot} onOpen={() => setFolded(false)} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <SweepBoard snapshot={snapshot} />
      {ended ? (
        <button type="button" className="self-end text-small text-fg-muted underline" onClick={() => setFolded(true)}>
          Hide the sweep
        </button>
      ) : null}
    </div>
  );
}
