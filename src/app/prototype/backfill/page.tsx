"use client";

/**
 * PROTOTYPE: the recorded first sweep in recorded-run.json, replayed from page
 * load through the same board the leads page draws over a live one. It is what
 * the launch video is filmed from. ?speed=2 runs it twice as fast, ?theme=dark
 * or light forces the theme, ?cols= and ?rows= size the wall, and ?project= lets
 * a phone's shelf read threads in full from a project that holds them.
 */
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SweepBoard } from "@/components/sweep/SweepBoard";
import type { SweepSnapshot, SweepThread } from "@/lib/sweep";
import recorded from "./recorded-run.json";

type Recorded = {
  totalMs: number;
  samples: { t: number; progress: string }[];
  usage: { t: number; purpose: string; items: number; usd: number }[];
  threads: (Omit<SweepThread, "verdict"> & {
    seen: number;
    verdict: (NonNullable<SweepThread["verdict"]> & { t: number }) | null;
  })[];
};

const RUN = recorded as Recorded;
/** The same reading the live board makes: once a second, and a title counts as set aside after six. */
const READ_MS = 1000;
const LAG_MS = 6000;
const ANSWERS: Record<string, number> = { triage: 2, score: 5 };

/** What the live reader would have answered `ms` into the recorded sweep. */
function snapshotAt(ms: number): SweepSnapshot {
  const done = ms >= RUN.totalMs;
  const found = RUN.threads.filter((thread) => thread.seen <= ms);
  const scored = found.filter((thread) => thread.verdict && thread.verdict.t <= ms);
  const aside = found.filter((thread) => !thread.verdict && (done || thread.seen <= ms - LAG_MS));
  const usage = RUN.usage.filter((row) => row.t <= ms);
  const items = (purpose: string) => usage.filter((row) => row.purpose === purpose).reduce((n, row) => n + row.items, 0);
  const triaged = Math.min(items("triage"), found.length);
  const progress = [...RUN.samples].reverse().find((sample) => sample.t <= ms)?.progress ?? null;
  const shown = (threads: typeof found, n: number): SweepThread[] => threads.slice(-n).reverse();
  return {
    state: done ? "done" : "running",
    progress,
    elapsedMs: Math.min(ms, RUN.totalMs),
    counts: {
      found: found.length,
      triaged,
      scored: scored.length,
      asideAtTitle: done ? found.length - scored.length : Math.max(0, triaged - Math.max(items("score"), scored.length)),
      buyers: scored.filter((thread) => thread.verdict?.relationship === "buyer").length,
      review: scored.filter((thread) => thread.verdict?.decision === "review").length,
      leads: scored.filter((thread) => thread.verdict?.decision === "qualify").length,
    },
    answers: usage.reduce((n, row) => n + row.items * (ANSWERS[row.purpose] ?? 0), 0),
    costUsd: usage.reduce((n, row) => n + row.usd, 0),
    feedLeads: scored.filter((thread) => thread.verdict?.decision === "qualify").length,
    threads: [
      ...shown([...scored].sort((a, b) => (a.verdict?.t ?? 0) - (b.verdict?.t ?? 0)), 160),
      ...shown(aside, 120),
    ],
  };
}

function Replay() {
  const params = useSearchParams();
  const speed = Number(params.get("speed") ?? "1") || 1;
  const theme = params.get("theme");
  const cols = Number(params.get("cols")) || undefined;
  const rows = Number(params.get("rows")) || undefined;
  const projectId = params.get("project") ?? undefined;
  const [snapshot, setSnapshot] = useState<SweepSnapshot>(() => snapshotAt(0));
  useEffect(() => {
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => {
      const next = snapshotAt((performance.now() - started) * speed);
      setSnapshot(next);
      if (next.state === "done") clearInterval(timer);
    }, READ_MS / speed);
    return () => clearInterval(timer);
  }, [speed]);
  return (
    <main className="min-h-screen bg-bg p-6 text-fg">
      <SweepBoard snapshot={snapshot} projectId={projectId} cols={cols} rows={rows} />
    </main>
  );
}

export default function BackfillReplayPage() {
  return <Suspense><Replay /></Suspense>;
}
