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
type SetupLine = { text: string; at: number };

/**
 * About how long each part of the setup takes, by how its line opens. The site
 * read is one model call, 15 s at the median of those measured 2026-09-18; the
 * rest are a fetch, a round of Google searches and their labelling, and the
 * wait for the sweep's first page. A line that only reports a result has none.
 */
const ABOUT_S: [RegExp, number][] = [
  [/^Opening /, 3],
  [/^Reading the page/, 15],
  [/^Asking Google/, 8],
  [/^Checked /, 3],
  [/^Starting the sweep/, 5],
];

function aboutSeconds(text: string): number | null {
  return ABOUT_S.find(([opens]) => opens.test(text))?.[1] ?? null;
}

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

function SweepSetup({ lines }: { lines: SetupLine[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const shown = lines.length > 0 ? lines : [{ text: "Starting", at: now }];
  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface px-6 py-5" aria-live="polite">
      <span className="flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-wide text-fg-muted">
        Setting up your project
        <span className="font-mono normal-case tabular-nums">
          {seconds(now - shown[0].at)} · about {ABOUT_S.reduce((sum, [, s]) => sum + s, 0)} s in all
        </span>
      </span>
      <ol className="flex flex-col gap-2">
        {shown.map((line, index) => {
          const current = index === shown.length - 1;
          const about = aboutSeconds(line.text);
          const took = (current ? now : shown[index + 1].at) - line.at;
          return (
            <li key={line.text} className="flex items-center gap-3 text-body" style={{ opacity: current ? 1 : 0.6 }}>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  background: current ? "var(--score-warm)" : "var(--score-hot)",
                  animation: current ? "sweepSetupPulse 1.2s ease-in-out infinite" : undefined,
                }}
              />
              <span className={`min-w-0 flex-1 ${current ? "text-fg" : "text-fg-muted"}`}>
                {line.text}
                {current ? "…" : ""}
              </span>
              {/* A line that reports a result was never waited on, so it has no clock. */}
              {about === null ? null : (
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-fg-muted">
                  <span className={current ? "text-fg" : undefined}>{seconds(took)}</span>
                  {current ? ` · about ${about} s` : ""}
                </span>
              )}
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
  const [lines, setLines] = useState<SetupLine[]>(() =>
    first.progress ? [{ text: first.progress, at: Date.now() }] : [],
  );
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
            setLines((seen) =>
              seen.some((one) => one.text === line) ? seen : [...seen, { text: line, at: Date.now() }],
            );
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
