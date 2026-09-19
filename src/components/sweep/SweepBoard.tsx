"use client";

import { memo, useEffect, useRef, useState } from "react";
import { jevAnswers, SweepLeads } from "@/components/sweep/SweepLeads";
import type { SweepCounts, SweepSnapshot, SweepThread } from "@/lib/sweep";

/**
 * A project's first sweep, drawn while it runs: the year's posts as a pile
 * going down into three, the same numbers as a funnel, what Jev answered about
 * one thread, and a wall of the threads themselves going past.
 *
 * The sweep hands its work over in bursts, a few hundred posts and then
 * nothing for a second or two, and this is read once a second on top of that.
 * Drawn as it arrives that is a still board that jumps. So every number here
 * follows the true one at a bounded pace, and the wall takes new threads from
 * a queue at the rate the queue is filling. Nothing is ever ahead of the
 * sweep, and every thread on the wall is one it really read.
 */

const TICK_MS = 50;
/** Seconds a count takes to close most of the gap to the true one. */
const FOLLOW_S = 1.2;
/** Seconds of queue the wall aims to hold, which is what sets its pace. */
const QUEUE_S = 2.5;
const WALL_MIN_PER_S = 12;
const WALL_MAX_PER_S = 160;
/** Threads Jev's answers are shown for, newest kept. */
const RING = 40;
/**
 * Leads the phone's list holds: the strongest so far. Newest first moved the
 * list under a finger several times a second; the strongest few settle.
 */
const KEPT = 10;
/** How long Jev's panel stays on one thread. */
const RING_STEP_MS = 90;

const CARD_W = 340;
const CARD_H = 176;
/** The pile's fixed height, and the sheet sizes it steps through to stay inside it. */
const PILE_H = 96;
const PILE_MAX_SHEETS = Math.floor((PILE_H - 6) / 2);
const SHEET_SIZES = [40, 100, 250, 500, 1000, 2500, 5000, 10000];

/** The smallest round sheet that keeps the whole year under the pile's height. */
function postsPerSheet(found: number): number {
  return SHEET_SIZES.find((size) => Math.ceil(found / size) <= PILE_MAX_SHEETS) ?? Math.ceil(found / PILE_MAX_SHEETS);
}

const COUNT_KEYS = ["found", "triaged", "scored", "asideAtTitle", "buyers", "review", "leads"] as const;

type View = {
  clockMs: number;
  counts: SweepCounts;
  wall: (SweepThread | null)[];
  /** Threads put on the wall so far, which is whose turn the next slot is. */
  placed: number;
  ring: SweepThread[];
  /** The highest-scoring lead the wall has carried, which the panel settles on. */
  best: SweepThread | null;
  /** The strongest leads and held threads the wall has carried, for the phone's list. */
  kept: SweepThread[];
  /** Threads finished with, a second ago and now, for the rate. */
  perSec: number;
};

const ZERO: SweepCounts = { found: 0, triaged: 0, scored: 0, asideAtTitle: 0, buyers: 0, review: 0, leads: 0 };

function settled(counts: SweepCounts): number {
  return counts.scored + counts.asideAtTitle;
}

/** The board's own state, advanced twenty times a second toward the newest snapshot. */
function useSweepView(snapshot: SweepSnapshot | null, slots: number): View {
  const [view, setView] = useState<View>(() => ({
    clockMs: 0, counts: ZERO, wall: Array.from({ length: slots }, () => null), placed: 0, ring: [], best: null, kept: [], perSec: 0,
  }));
  const latest = useRef<{ snapshot: SweepSnapshot | null; at: number }>({ snapshot: null, at: 0 });
  const seen = useRef(new Set<string>());
  const queue = useRef<SweepThread[]>([]);
  const owed = useRef(0);
  const history = useRef<{ at: number; n: number }[]>([]);

  useEffect(() => {
    latest.current = { snapshot, at: performance.now() };
    if (!snapshot) {
      return;
    }
    // Newest first as it arrives; the wall wants them in the order they ended.
    const fresh = snapshot.threads.filter((thread) => !seen.current.has(`${thread.id}:${thread.verdict ? "v" : "t"}`));
    for (const thread of fresh) {
      seen.current.add(`${thread.id}:${thread.verdict ? "v" : "t"}`);
    }
    const scored = fresh.filter((thread) => thread.verdict).reverse();
    const aside = fresh.filter((thread) => !thread.verdict).reverse();
    // The two kinds end at the same moments, so they go on the wall mixed.
    const mixed: SweepThread[] = [];
    for (let i = 0; i < Math.max(scored.length, aside.length); i += 1) {
      if (i < scored.length) mixed.push(scored[i]);
      if (i < aside.length) mixed.push(aside[i]);
    }
    queue.current.push(...mixed);
  }, [snapshot]);

  useEffect(() => {
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { snapshot: snap, at } = latest.current;
      if (!snap) {
        return;
      }
      const running = snap.state === "running";
      const waiting = queue.current.length;
      const pace = waiting === 0 ? 0 : Math.min(WALL_MAX_PER_S, Math.max(WALL_MIN_PER_S, waiting / QUEUE_S));
      owed.current = Math.min(waiting, owed.current + pace * dt);
      const taken = queue.current.splice(0, Math.floor(owed.current));
      owed.current -= taken.length;

      setView((before) => {
        const counts = { ...before.counts };
        let moving = false;
        for (const key of COUNT_KEYS) {
          const gap = snap.counts[key] - counts[key];
          if (gap !== 0) {
            // A running sweep closes the gap steadily; one that has ended closes it at once.
            const step = Math.max(Math.abs(gap) * (dt / (running ? FOLLOW_S : 0.4)), 6 * dt);
            counts[key] = Math.abs(gap) <= step ? snap.counts[key] : counts[key] + Math.sign(gap) * step;
            moving = true;
          }
        }
        const clockMs = running ? snap.elapsedMs + (now - at) : snap.elapsedMs;
        if (!moving && taken.length === 0 && clockMs === before.clockMs && !running) {
          return before;
        }
        let wall = before.wall;
        let ring = before.ring;
        let best = before.best;
        let kept = before.kept;
        if (taken.length > 0) {
          wall = [...before.wall];
          taken.forEach((thread, index) => {
            // Thirty-seven shares no factor with any wall size used, so every
            // slot gets its turn while new threads land all over the wall.
            wall[((before.placed + index) * 37) % slots] = thread;
          });
          ring = [...before.ring, ...taken.filter((thread) => thread.verdict)].slice(-RING);
          const keep = taken.filter((thread) => thread.verdict && thread.verdict.decision !== "reject");
          if (keep.length > 0) {
            const ids = new Set(keep.map((thread) => thread.id));
            // A stable sort, so equal scores stay in the order they arrived.
            kept = [...before.kept.filter((thread) => !ids.has(thread.id)), ...keep]
              .sort((a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0))
              .slice(0, KEPT);
          }
          for (const thread of taken) {
            if (thread.verdict?.decision === "qualify" && thread.verdict.score > (best?.verdict?.score ?? -1)) {
              best = thread;
            }
          }
        }
        // An updater can be run twice, and one tick is one entry.
        if (history.current[history.current.length - 1]?.at !== now) {
          history.current.push({ at: now, n: settled(counts) });
        }
        while (history.current.length > 1 && history.current[0].at < now - 1000) {
          history.current.shift();
        }
        return {
          clockMs,
          counts,
          wall,
          placed: before.placed + taken.length,
          ring,
          best,
          kept,
          perSec: running ? Math.round(settled(counts) - history.current[0].n) : 0,
        };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [slots]);

  return view;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-mono text-fg-muted uppercase" style={{ letterSpacing: "0.09em" }}>
      {children}
    </span>
  );
}

/* ---------------- the pile ---------------- */

function ink(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
}

/** The year's posts as one stack of paper going down, and three going up. */
function Pile({ counts, perSheet }: { counts: SweepCounts; perSheet: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const leads = counts.leads;
  const review = counts.review;
  const aside = Math.max(0, counts.asideAtTitle + counts.scored - leads - review);
  const unread = Math.max(0, counts.found - counts.asideAtTitle - counts.scored);
  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const stack = (x: number, width: number, posts: number, color: string, alpha: number) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      const sheets = Math.ceil(posts / perSheet);
      for (let i = 0; i < sheets; i += 1) {
        // Paper never stacks square, and the offset has to stay put per sheet.
        const nudge = ((i * 7919) % 5) - 2;
        ctx.fillRect(x + nudge, h - 4 - i * 2, width, 1);
      }
    };
    stack(w * 0.02, w * 0.3, unread, ink("--fg"), 0.7);
    stack(w * 0.4, w * 0.22, aside, ink("--fg-muted"), 0.45);
    stack(w * 0.66, w * 0.14, review, ink("--score-warm"), 1);
    stack(w * 0.84, w * 0.14, leads, ink("--score-hot"), 1);
    ctx.globalAlpha = 1;
  });
  const label = (left: string, name: string, n: number, color?: string) => (
    <span className="absolute top-0 flex flex-col text-mono text-fg-muted" style={{ left }}>
      <span className="font-mono text-[18px] leading-tight tabular-nums text-fg" style={color ? { color } : undefined}>
        {fmt(n)}
      </span>
      {name}
    </span>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full" style={{ height: PILE_H }}>
        <canvas ref={ref} className="absolute inset-0" />
      </div>
      <div className="h-px w-full" style={{ background: "var(--border)" }} />
      <div className="relative h-11 w-full">
        {label("2%", "unread", unread)}
        {label("40%", "set aside", aside)}
        {label("66%", "review", review, "var(--score-warm)")}
        {label("84%", "leads", leads, "var(--score-hot)")}
      </div>
    </div>
  );
}

/* ---------------- the sieve ---------------- */

/** The same sweep as a funnel: each band is what the one above let through. */
function Sieve({ counts }: { counts: SweepCounts }) {
  const top = Math.max(1, counts.found);
  const rows: [string, number, string][] = [
    ["found by the searches", counts.found, "var(--surface-2)"],
    ["titles read", counts.asideAtTitle + counts.scored, "color-mix(in oklch, var(--series-1) 14%, var(--surface))"],
    ["read in full and scored", counts.scored, "color-mix(in oklch, var(--series-1) 28%, var(--surface))"],
    ["people who want to buy", counts.buyers, "color-mix(in oklch, var(--score-hot) 28%, var(--surface))"],
    ["asking for what you sell", counts.leads, "var(--score-hot)"],
  ];
  const width = (n: number) => (n <= 0 ? 0 : Math.max(1.2, (n / top) * 100));
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([label, n, fill], index) => {
        const wide = width(n);
        const nextWide = index + 1 < rows.length ? width(rows[index + 1][1]) : wide;
        const taper = wide === 0 ? 0 : Math.min(50, (nextWide / wide) * 50);
        return (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-mono text-fg-muted">{label}</span>
              <span
                className="font-mono text-[16px] leading-none tabular-nums"
                style={index === rows.length - 1 ? { color: "var(--score-hot)" } : undefined}
              >
                {fmt(n)}
              </span>
            </div>
            <div className="relative h-[14px]">
              {wide === 0 ? null : (
                <div
                  className="absolute inset-y-0 left-1/2 -translate-x-1/2"
                  style={{
                    width: `${wide}%`, minWidth: 4, background: fill,
                    clipPath: `polygon(0 0, 100% 0, ${50 + taper}% 100%, ${50 - taper}% 100%)`,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Jev's answers ---------------- */


/**
 * What Jev answered about one thread. Verdicts land far faster than anyone can
 * read them, so this walks the newest few at a steady pace rather than sitting
 * on one, and settles on the strongest lead once the sweep is over.
 */
function JevAtWork({ view, over, answers }: { view: View; over: boolean; answers: number }) {
  const ring = view.ring;
  const thread =
    ring.length === 0 ? null : over ? view.best ?? ring[ring.length - 1] : ring[Math.floor(view.clockMs / RING_STEP_MS) % ring.length];
  const verdict = thread?.verdict ?? null;
  const rows = thread ? jevAnswers(thread) : [];
  return (
    <section className="flex flex-col gap-3 rounded-card border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow>{over ? "Jev on the strongest lead" : "Jev, right now"}</Eyebrow>
        <span className="text-mono tabular-nums text-fg-muted">{fmt(answers)} typed answers</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="truncate text-small text-fg" style={{ fontWeight: 500 }}>
          {thread?.title ?? "Waiting for the first thread"}
        </span>
        <span className="truncate text-mono text-fg-muted">{thread ? `r/${thread.subreddit}` : " "}</span>
      </div>
      <div className="flex flex-col">
        {rows.map(([asked, answer], index) => (
          <div key={asked} className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
            <span className="shrink-0 text-mono text-fg-muted">{asked}</span>
            <span
              className="min-w-0 truncate text-right font-mono text-[12px]"
              style={{
                color:
                  index < rows.length - 1
                    ? "var(--fg)"
                    : verdict?.decision === "qualify" ? "var(--score-hot)" : "var(--fg-muted)",
              }}
            >
              {answer}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- a thread, the way Reddit shows it ---------------- */

/** Reddit's own light and dark palettes, since the point of the card is to be recognised. */
function RedditTheme() {
  return (
    <style>{`
      :root { --rd-card: #ffffff; --rd-line: #e5ebee; --rd-title: #0f1a1c; --rd-body: #2a3c42; --rd-meta: #5c6c74;
        --rd-pill: #e5ebee; --rd-page: #f2f4f5; --rd-aside: #8a9aa2; }
      [data-theme="dark"] { --rd-card: #181c1f; --rd-line: #2a3236; --rd-title: #eef1f3; --rd-body: #b7cad4; --rd-meta: #8ba2ad;
        --rd-pill: #2a3236; --rd-page: #0e1113; --rd-aside: #5c6c74; }
      @keyframes sweepLand { from { opacity: 0; transform: scale(0.96); } }
      @keyframes sweepPulse { 0% { opacity: 0.35; } 50% { opacity: 1; } 100% { opacity: 0.35; } }
    `}</style>
  );
}

function shortCount(n: number | null): string {
  const v = n ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(v);
}

function ago(createdAt: string): string {
  const days = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (24 * 3600 * 1000));
  if (days < 1) return "today";
  if (days < 7) return `${Math.floor(days)} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk. ago`;
  if (days < 365) return `${Math.floor(days / 30.4)} mo. ago`;
  return "1 yr. ago";
}

function subHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px]"
      style={{ background: "var(--rd-pill)", color: "var(--rd-title)", fontWeight: 600 }}
    >
      {children}
    </span>
  );
}

const ARROW = "M10 3.2 3.5 10h3.8v6.3h5.4V10h3.8L10 3.2Z";
const BUBBLE = "M10 3.5c-3.9 0-7 2.7-7 6.1 0 1.6.7 3 1.8 4.1L4 17l3.5-1.2c.8.2 1.6.4 2.5.4 3.9 0 7-2.7 7-6.1S13.9 3.5 10 3.5Z";

/** One thread as Reddit lays it out, with what the sweep made of it over the corner. */
const RedditPost = memo(function RedditPost({ thread }: { thread: SweepThread }) {
  const decision = thread.verdict?.decision;
  const lead = decision === "qualify";
  const held = decision === "review";
  const tone = lead ? "var(--score-hot)" : held ? "var(--score-warm)" : "var(--rd-aside)";
  const stamp = lead ? "lead" : held ? "review" : thread.verdict ? "set aside" : "title only";
  return (
    <div
      className="relative flex flex-col gap-1.5 overflow-hidden rounded-[16px] px-4 py-3"
      style={{
        width: CARD_W - 12, height: CARD_H - 12, background: "var(--rd-card)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        boxShadow: lead || held ? `0 0 0 2.5px ${tone}` : "0 0 0 1px var(--rd-line)",
        opacity: lead || held ? 1 : 0.5,
        animation: "sweepLand 180ms ease-out backwards",
      }}
    >
      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--rd-meta)" }}>
        <span
          className="flex size-5 items-center justify-center rounded-full text-[10px] text-white"
          style={{ background: `hsl(${subHue(thread.subreddit)} 60% 45%)`, fontWeight: 700 }}
        >
          r/
        </span>
        <span style={{ color: "var(--rd-title)", fontWeight: 600 }}>r/{thread.subreddit}</span>
        <span>•</span>
        <span>{ago(thread.createdAt)}</span>
      </div>
      <div
        className="text-[16px] leading-[1.25]"
        style={{ color: "var(--rd-title)", fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {thread.title}
      </div>
      {thread.body ? (
        <div
          className="text-[13px] leading-[1.4]"
          style={{ color: "var(--rd-body)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {thread.body}
        </div>
      ) : null}
      <div className="mt-auto flex items-center gap-2">
        <Pill>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={ARROW} /></svg>
          {shortCount(thread.ups)}
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ transform: "rotate(180deg)" }}><path d={ARROW} /></svg>
        </Pill>
        <Pill>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={BUBBLE} /></svg>
          {shortCount(thread.comments)}
        </Pill>
        <Pill>Share</Pill>
      </div>
      <div
        className="absolute top-2.5 right-2.5 rounded-full px-2.5 py-1 font-mono text-[11px] text-white"
        style={{ background: tone }}
      >
        {stamp}
        {thread.verdict ? ` · ${thread.verdict.score}` : ""}
      </div>
    </div>
  );
});

/**
 * A wall of threads at whatever width it is given. Cards are laid out at
 * Reddit's own size and shrunk together, so they keep their proportions however
 * many are asked for.
 */
function ThreadWall({ wall, cols }: { wall: (SweepThread | null)[]; cols: number }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(900);
  useEffect(() => {
    const measure = () => setWide(box.current?.clientWidth ?? 900);
    measure();
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const rows = Math.ceil(wall.length / cols);
  const scale = wide / (cols * CARD_W);
  return (
    <div ref={box} className="relative w-full overflow-hidden" style={{ height: rows * CARD_H * scale, background: "var(--rd-page)" }}>
      <div
        className="absolute top-0 left-0 grid"
        style={{
          width: cols * CARD_W, gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`, gridAutoRows: `${CARD_H}px`,
          placeItems: "center", transformOrigin: "0 0", transform: `scale(${scale})`,
        }}
      >
        {wall.map((thread, slot) =>
          thread ? <RedditPost key={`${slot}:${thread.id}`} thread={thread} /> : <div key={slot} />,
        )}
      </div>
    </div>
  );
}

/* ---------------- the board ---------------- */

export function SweepBoard({
  snapshot,
  projectId,
  cols = 6,
  rows = 8,
}: {
  snapshot: SweepSnapshot | null;
  /** The project the sweep is for, which lets a phone's shelf read a thread in full. */
  projectId?: string;
  cols?: number;
  rows?: number;
}) {
  const view = useSweepView(snapshot, cols * rows);
  const running = snapshot?.state === "running" || snapshot?.state === "waiting" || snapshot === null;
  const over = !running && view.counts.scored === snapshot?.counts.scored;
  const perSheet = postsPerSheet(view.counts.found);
  return (
    // One column below lg is still a declared one: an implicit track is as wide
    // as its longest unbroken line, and Jev's title and quote change several
    // times a second, so on a phone the board ran off the screen and resized
    // with every thread.
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,11fr)]">
      <RedditTheme />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-baseline gap-3 px-1">
          <span className="font-mono text-[44px] leading-none tabular-nums text-fg">
            {(view.clockMs / 1000).toFixed(1)}
            <span className="text-[20px] text-fg-muted"> s</span>
          </span>
          <span className="inline-flex items-center gap-2 text-mono text-fg-muted">
            <span
              className="size-1.5 rounded-full"
              style={{
                background: running ? "var(--score-warm)" : "var(--score-hot)",
                animation: running ? "sweepPulse 1.6s ease-in-out infinite" : undefined,
              }}
            />
            {running ? "reading" : snapshot?.state === "stopped" ? "stopped" : "done"}
          </span>
        </div>
        <section className="flex flex-col gap-4 rounded-card border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <Eyebrow>The past year</Eyebrow>
            <span className="text-mono text-fg-muted">one sheet is {perSheet.toLocaleString()} threads</span>
          </div>
          <Pile counts={view.counts} perSheet={perSheet} />
        </section>
        <section className="flex flex-col gap-4 rounded-card border bg-surface p-4">
          <Eyebrow>What got through</Eyebrow>
          <Sieve counts={view.counts} />
        </section>
        <JevAtWork view={view} over={over} answers={snapshot?.answers ?? 0} />
      </div>

      <section className="flex flex-col overflow-hidden rounded-card border bg-surface max-lg:hidden">
        <ThreadWall wall={view.wall} cols={cols} />
      </section>
      <div className="min-w-0 lg:hidden">
        <SweepLeads leads={view.kept} total={view.counts.leads + view.counts.review} projectId={projectId} />
      </div>
    </div>
  );
}
