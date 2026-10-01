"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sweepAction } from "@/app/app/leads/actions";
import { useHoldActivityPoll } from "@/components/ActivityPoll";
import { Fleeting } from "@/components/Fleeting";
import { ScanDone } from "@/components/leads/ScanBanner";
import type { SweepStatus } from "@/lib/sweep";

/** A second is as often as the sweep has anything new to say. */
const POLL_MS = 1000;

/**
 * The fewest milliseconds between two re-reads of the feed. A chunk of verdicts
 * lands every few seconds, and each re-read draws the whole page again, so a
 * lead that arrives inside this is drawn with the next one.
 */
const REFRESH_GAP_MS = 2000;

/**
 * What a new project is doing before its sweep starts, as a log of each thing
 * it finishes. It is only ever this, the half minute the site read and Google
 * take; once the sweep is reading, the leads it finds are the page, and this
 * folds to one line over them.
 */
type SetupLine = { text: string; at: number };

/**
 * About how long each part of the setup takes, by how its line opens, as timed
 * on real signups 2026-09-18: the site read is one model call of about 25 s,
 * and the Google rounds are about a second each. A line that only reports a
 * result has none.
 */
const ABOUT_S: [RegExp, number][] = [
  [/^Opening /, 3],
  [/^Reading the page/, 25],
  [/^Asking Google/, 1],
  [/^Checked /, 1],
  [/^Starting the sweep/, 5],
];

function aboutSeconds(text: string): number | null {
  return ABOUT_S.find(([opens]) => opens.test(text))?.[1] ?? null;
}

const seconds = (ms: number) => `${Math.round(Math.max(0, ms) / 1000)} s`;

function Pulse({ warm }: { warm: boolean }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full${warm ? " animate-scan-pulse" : ""}`}
      style={{ background: warm ? "var(--score-warm)" : "var(--score-hot)" }}
    />
  );
}

function SweepSetup({ lines }: { lines: SetupLine[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const shown = lines.length > 0 ? lines : [{ text: "Starting", at: now }];
  const total = ABOUT_S.reduce((sum, [, s]) => sum + s, 0) * 1000;
  const left = total - (now - shown[0].at);
  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface px-4 py-4 sm:px-5" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span style={{ fontWeight: 500 }}>Finding your first leads</span>
        <span className="text-small font-mono tabular-nums text-fg-muted">
          {left > 0 ? `about ${seconds(left)} to go` : "taking longer than usual"}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {shown.map((line, index) => {
          const current = index === shown.length - 1;
          const about = aboutSeconds(line.text);
          const took = (current ? now : shown[index + 1].at) - line.at;
          return (
            <li key={line.text} className="text-small flex items-center gap-3" style={{ opacity: current ? 1 : 0.6 }}>
              <Pulse warm={current} />
              <span className={`min-w-0 ${current ? "text-fg" : "text-fg-muted"}`}>
                {line.text}
                {current ? "…" : ""}
              </span>
              {/* A line that reports a result was never waited on, so it has no clock. */}
              {about === null || !current ? null : (
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-fg-muted">
                  {seconds(took)} · about {about} s
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The sweep in one line while it reads, and a banner once it is over. */
function SweepLine({ projectId, status }: { projectId: string; status: SweepStatus }) {
  const leads = `${status.feedLeads.toLocaleString()} ${status.feedLeads === 1 ? "lead" : "leads"}`;
  const threads = `${status.found.toLocaleString()} threads`;
  if (status.state === "done") {
    return (
      <Fleeting id={`sweep-done:${projectId}`}>
        <ScanDone
          title={status.feedLeads === 0 ? "Scan done. No leads in the past year yet." : `Scan done. Found ${leads}.`}
          line={`Read ${threads} from the past year. New ones arrive with each scan.`}
        />
      </Fleeting>
    );
  }
  const text =
    status.state === "stopped"
      ? `The sweep stopped early with ${leads} found. It picks up where it left off on its own.`
      : status.found === 0
        ? "Searching a year of Reddit for your first lead"
        : status.feedLeads === 0
          ? `Read ${threads} from the past year, looking for your first lead`
          : `${leads} so far, from ${threads}. More are added below as they are found`;
  return (
    <div
      className="text-small flex items-center gap-3 rounded-card border bg-surface px-4 py-2.5"
      aria-live="polite"
    >
      <Pulse warm={status.state === "running"} />
      <span className="min-w-0 flex-1">
        {text}
        {status.state === "running" ? "…" : ""}
      </span>
      {status.state === "running" ? (
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-fg-muted">{seconds(status.elapsedMs)}</span>
      ) : null}
    </div>
  );
}

/**
 * A project's first sweep, reported over the feed it is filling. It reads the
 * sweep once a second and, whenever the feed's count of leads moves, reads the
 * page again, so each lead is on screen a moment after it is judged rather
 * than at the end of the sweep.
 */
export function FirstSweep({ projectId, first }: { projectId: string; first: SweepStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(first);
  const ended = status.state === "done" || status.state === "stopped";
  // A read that finds no sweep at all means the jobs behind it are gone, which
  // a failed setup leaves. This has nothing more to report then, so it stops
  // reading the sweep and never reads the page again.
  const [gone, setGone] = useState(false);
  // This reads the page again whenever a lead lands, so the layout's poll has
  // nothing to add while the sweep runs. It takes over again once the sweep
  // ends or is gone, for the jobs a new project runs after it.
  useHoldActivityPoll(!ended && !gone);
  const [lines, setLines] = useState<SetupLine[]>(() =>
    first.progress ? [{ text: first.progress, at: Date.now() }] : [],
  );
  const setup = status.state === "waiting";
  // The page was drawn with `first`, so it is read again when the count moves
  // past that or the sweep ends, and no more often than every couple of seconds.
  const drawnFor = useRef({ leads: first.feedLeads, ended });
  const refreshedAt = useRef(0);
  useEffect(() => {
    if (status.feedLeads === drawnFor.current.leads && ended === drawnFor.current.ended) {
      return;
    }
    const wait = Math.max(0, refreshedAt.current + REFRESH_GAP_MS - Date.now());
    const timer = setTimeout(() => {
      drawnFor.current = { leads: status.feedLeads, ended };
      refreshedAt.current = Date.now();
      router.refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [status.feedLeads, ended, router]);

  useEffect(() => {
    if (ended || gone) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await sweepAction(projectId);
        if (!stopped && next === null) {
          setGone(true);
        }
        if (!stopped && next) {
          setStatus(next);
          const line = next.progress;
          if (line && next.state === "waiting") {
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
  }, [projectId, ended, gone]);

  return setup ? <SweepSetup lines={lines} /> : <SweepLine projectId={projectId} status={status} />;
}
