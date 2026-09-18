"use client";

/**
 * PROTOTYPE. Three boards over one backfill (see sim.ts for the shape, and
 * replay.ts for the recorded run they draw by default). They are three answers
 * to the same question, which is what a person should understand after five
 * seconds of watching a new project read a year of Reddit:
 *
 *   A  the feed filling up, because the leads are the product
 *   B  the 62 seconds as one trace, because the shape of the minute is the point
 *   C  the sieve, because 4,229 to 129 is the whole job in one picture
 *
 * Every number comes off the state, which comes off the run. The only constant
 * is what a person costs: thirty seconds to read one post and decide.
 */
import { useEffect, useRef } from "react";
import {
  fmtInt, fmtSecs, fmtUsd, itemsPerSec, PHASE_LABEL, RELATIONSHIPS,
  type Relationship, type SimPost, type SimState,
} from "./sim";

/** What one post costs a person who reads it and decides: half a minute. */
const HUMAN_SECONDS_PER_POST = 30;

const REL_VAR: Record<Relationship, string> = {
  buyer: "--score-hot",
  seller: "--series-2",
  helper: "--series-1",
  discussion: "--fg-muted",
  unknown: "--border",
};
const REL_LABEL: Record<Relationship, string> = {
  buyer: "wants to buy",
  seller: "selling",
  helper: "answering",
  discussion: "just talking",
  unknown: "unclear",
};
const NEED_LABEL: Record<string, string> = {
  open: "need open",
  evaluating: "weighing options",
  resolved: "already sorted",
  no_active_need: "no need",
  unknown: "need unclear",
};
const INTENT_WORD = ["no ask", "hinting", "asking around", "asking", "ready"];

function relColor(rel: Relationship | undefined): string {
  return `var(${REL_VAR[rel ?? "unknown"]})`;
}
function humanHours(judged: number): number {
  return (judged * HUMAN_SECONDS_PER_POST) / 3600;
}
/** Posts through Jev per second, counting the triage pass and the scoring one. */
function rateNote(s: SimState): string {
  return `${Math.round(itemsPerSec(s))} a second through Jev`;
}
function isLead(post: SimPost): boolean {
  return post.decision === "qualify";
}
/** The last `n` posts matching, newest first, without walking all of them twice. */
function recentWhere(posts: SimPost[], ok: (p: SimPost) => boolean, n: number): SimPost[] {
  const out: SimPost[] = [];
  for (let i = posts.length - 1; i >= 0 && out.length < n; i -= 1) {
    if (ok(posts[i])) out.push(posts[i]);
  }
  return out;
}
function best(posts: SimPost[], ok: (p: SimPost) => boolean): SimPost | null {
  let top: SimPost | null = null;
  for (const post of posts) {
    if (ok(post) && (top === null || (post.score ?? 0) > (top.score ?? 0))) top = post;
  }
  return top;
}

/**
 * The motion, in one place. Tokens hold one duration for a state change, and
 * something arriving on screen wants a little longer than that, so these are
 * the multiples of it rather than new numbers.
 */
function Motion() {
  return (
    <style>{`
      @keyframes lurkRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes lurkPulse { 0% { opacity: 0.35; } 50% { opacity: 1; } 100% { opacity: 0.35; } }
      @keyframes lurkFade { from { opacity: 0; } to { opacity: 1; } }
      .lurk-rise { animation: lurkRise calc(var(--motion) * 2.5) ease-out both; }
      .lurk-fade { animation: lurkFade calc(var(--motion) * 3) ease both; }
      .lurk-live { animation: lurkPulse 1.6s ease-in-out infinite; }
    `}</style>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-mono uppercase text-fg-muted" style={{ letterSpacing: "0.09em" }}>
      {children}
    </span>
  );
}

function PhasePill({ s }: { s: SimState }) {
  const running = s.phase !== "done" && s.phase !== "idle";
  return (
    <span className="inline-flex items-center gap-2 rounded-control border bg-surface px-2.5 py-1 text-mono text-fg-muted">
      <span
        className={running ? "size-1.5 rounded-full lurk-live" : "size-1.5 rounded-full"}
        style={{ background: running ? "var(--score-warm)" : "var(--score-hot)" }}
      />
      {PHASE_LABEL[s.phase]}
    </span>
  );
}

function Stat({ label, value, unit, note, accent }: {
  label: string; value: string; unit?: string; note?: string; accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-card border bg-surface px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <span
        className="font-mono text-[26px] leading-none tabular-nums"
        style={accent ? { color: "var(--score-hot)" } : undefined}
      >
        {value}
        {unit ? <span className="ml-1 text-[13px] text-fg-muted">{unit}</span> : null}
      </span>
      {note ? <span className="text-mono text-fg-muted">{note}</span> : null}
    </div>
  );
}

function SubChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-control bg-surface-2 px-2 py-0.5 text-mono text-fg-muted">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--reddit)" }} />
      r/{name}
    </span>
  );
}

function RelChip({ post }: { post: SimPost }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-mono"
      style={{ color: relColor(post.relationship), borderColor: relColor(post.relationship) }}
    >
      {REL_LABEL[post.relationship ?? "unknown"]}
    </span>
  );
}

function FitDots({ fit }: { fit: number | null | undefined }) {
  if (fit == null) return null;
  return (
    <span className="flex items-center gap-[3px]" aria-label={`Fit ${fit} of 4`}>
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className="size-[5px] rounded-full"
          style={{ background: "var(--score-hot)", opacity: step <= fit ? 1 : 0.25 }}
        />
      ))}
    </span>
  );
}

/** The judgement, as the feed writes it: what they are, then how far along. */
function Verdict({ post }: { post: SimPost }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SubChip name={post.subreddit} />
      <RelChip post={post} />
      <span className="text-mono text-fg-muted">{NEED_LABEL[post.needState ?? "unknown"] ?? post.needState}</span>
      <span className="flex items-center gap-1.5 text-mono" style={{ color: "var(--score-hot)" }}>
        {INTENT_WORD[post.intent ?? 0]}
        <FitDots fit={post.fit} />
      </span>
    </div>
  );
}

/** The sentence the person wrote, which is the only unarguable part. */
function Quote({ text }: { text: string }) {
  return (
    <blockquote
      className="border-l-2 pl-3 text-body text-fg-muted"
      style={{ borderColor: "var(--score-warm)" }}
    >
      <mark
        className="rounded-sm px-0.5 text-fg"
        style={{ background: "color-mix(in oklch, var(--score-warm) 22%, transparent)" }}
      >
        {text}
      </mark>
    </blockquote>
  );
}

function LeadCard({ post }: { post: SimPost }) {
  const quote = post.quote?.trim();
  // Plenty of asks are the whole title, and printing the same sentence twice
  // reads as a bug. When they are the same sentence, the title is the quote.
  const echo = quote !== undefined && quote === post.title.trim();
  return (
    <article className="lurk-rise flex flex-col gap-2.5 rounded-card border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        {echo ? (
          <div className="min-w-0 flex-1">
            <Quote text={quote} />
          </div>
        ) : (
          <h3 className="min-w-0 truncate text-small text-fg" style={{ fontWeight: 500 }}>
            {post.title}
          </h3>
        )}
        <span className="shrink-0 text-mono tabular-nums text-fg-muted">
          {fmtSecs(post.atMs ?? 0)}
        </span>
      </div>
      {!echo && quote ? <Quote text={quote} /> : null}
      <Verdict post={post} />
    </article>
  );
}

/** Where the minute is, with the moment the feed became useful marked on it. */
function Rail({ s }: { s: SimState }) {
  const total = s.marks.totalMs || Math.max(1, s.elapsedMs);
  const pct = Math.min(100, (s.elapsedMs / total) * 100);
  const firstPass = Math.min(100, (s.marks.firstPassMs / total) * 100);
  const reached = s.elapsedMs >= s.marks.firstPassMs;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-motion"
          style={{ width: `${pct}%`, background: "var(--fg)" }}
        />
      </div>
      <div className="relative h-4">
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-mono"
          style={{ left: `${firstPass}%`, color: reached ? "var(--score-hot)" : "var(--fg-muted)" }}
        >
          {fmtSecs(s.marks.firstPassMs)} every search swept once
        </span>
      </div>
    </div>
  );
}

/** Who the year turned out to be, as one bar. */
function RelationshipSplit({ s }: { s: SimState }) {
  const by = s.counts.byRelationship;
  const total = Math.max(1, s.counts.judged);
  return (
    <div className="flex flex-col gap-2.5 rounded-card border bg-surface p-4">
      <Eyebrow>Who the year turned out to be</Eyebrow>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
        {RELATIONSHIPS.map((rel) => (
          <span
            key={rel}
            className="h-full transition-motion"
            style={{ width: `${(by[rel] / total) * 100}%`, background: relColor(rel) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {RELATIONSHIPS.filter((rel) => by[rel] > 0).map((rel) => (
          <span key={rel} className="flex items-center gap-1.5 text-mono text-fg-muted">
            <span className="size-1.5 rounded-full" style={{ background: relColor(rel) }} />
            {REL_LABEL[rel]}
            <span className="tabular-nums text-fg">{fmtInt(by[rel])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The comparison, kept to what the run can prove: the posts it actually read,
 * at half a minute each, against the seconds and the cents it took instead.
 */
function WhatItReplaces({ s }: { s: SimState }) {
  const hours = humanHours(s.counts.judged);
  const perDollar = s.costUsd > 0 ? s.counts.leads / s.costUsd : 0;
  return (
    <div className="flex flex-col gap-3 rounded-card border bg-surface p-4">
      <Eyebrow>What it would have taken a person</Eyebrow>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[30px] leading-none tabular-nums">{hours.toFixed(1)}</span>
        <span className="text-small text-fg-muted">
          hours of reading · {fmtInt(s.counts.judged)} posts at 30s each
        </span>
      </div>
      <div className="h-px w-full" style={{ background: "var(--border)" }} />
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[30px] leading-none tabular-nums" style={{ color: "var(--score-hot)" }}>
          {fmtUsd(s.costUsd)}
        </span>
        <span className="text-small text-fg-muted">
          of Jev, in {fmtSecs(s.elapsedMs)}
        </span>
      </div>
      <span className="text-mono text-fg-muted">
        {fmtInt(s.items)} posts asked about · {fmtInt(s.judgments)} typed answers
        {perDollar > 0 ? ` · ${fmtInt(perDollar)} leads per dollar` : ""}
      </span>
    </div>
  );
}

/* ---------------- A: reading a year ---------------- */

/**
 * The calm one. It is the real feed, filling. The leads arrive as the cards
 * they will be tomorrow morning, quote and all, and the strip beside them says
 * how much of the year they came out of. The story it tells is that you get
 * something to read three seconds in and a usable feed at fourteen.
 */
export function VariantA({ s }: { s: SimState }) {
  const c = s.counts;
  const leads = recentWhere(s.posts, isLead, 4);
  const done = s.phase === "done";
  return (
    <main className="min-h-screen bg-bg px-8 py-8 text-fg">
      <Motion />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>New project · first backfill</Eyebrow>
            <h1 className="text-h2" style={{ fontWeight: 500 }}>
              Reading a year of Reddit
            </h1>
            <p className="text-small text-fg-muted">
              Jev answers seven typed questions about every post it finds, and keeps the sentence
              that made it say yes.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <PhasePill s={s} />
            <span className="font-mono text-[40px] leading-none tabular-nums">{fmtSecs(s.elapsedMs)}</span>
          </div>
        </header>

        <Rail s={s} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]">
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-h3" style={{ fontWeight: 500 }}>
                {done ? "Leads from the year" : "Leads, as they qualify"}
              </h2>
              <span className="text-mono text-fg-muted">
                {fmtInt(c.leads)} qualified · {fmtInt(c.review)} held for review
              </span>
            </div>
            {leads.length === 0 ? (
              <div className="rounded-card border bg-surface p-6 text-small text-fg-muted">
                Searching. The first verdicts land about three seconds in.
              </div>
            ) : (
              leads.map((post) => <LeadCard key={post.id} post={post} />)
            )}
            {c.leads === 0 ? null : (
              <p className="text-mono text-fg-muted">
                {c.leads > leads.length
                  ? `Showing the ${leads.length} newest of ${fmtInt(c.leads)}.`
                  : `All ${fmtInt(c.leads)} so far.`}
                {" "}Everything else was read and set aside: {fmtInt(c.rejected)} posts Jev could say
                were not your buyer.
              </p>
            )}
          </section>

          <aside className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Posts found" value={fmtInt(c.found)} note={`${fmtInt(c.subreddits)} communities`} />
              <Stat label="Judged" value={fmtInt(c.judged)} note={rateNote(s)} />
              <Stat label="Leads" value={fmtInt(c.leads)} accent note="asking for what you sell" />
              <Stat label="Jev spend" value={fmtUsd(s.costUsd)} note={`${fmtInt(s.judgments)} answers`} />
            </div>
            <WhatItReplaces s={s} />
            <RelationshipSplit s={s} />
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ---------------- B: the 62 seconds ---------------- */

/**
 * Every verdict of the run as one mark on one trace: the time it landed across,
 * what Jev decided by direction, who the person was by colour, how sure it was
 * by length. The hum below the line is the year being cleared; the spikes above
 * it are the leads. It is the only board where you can see that the work never
 * stopped and that the leads were arriving from the third second on.
 */
function Trace({ s }: { s: SimState }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawn = useRef(0);
  const box = useRef({ w: 0, h: 0 });
  const total = s.marks.totalMs || Math.max(1, s.elapsedMs);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (box.current.w !== w || box.current.h !== h) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      box.current = { w, h };
      drawn.current = 0;
    }
    const css = getComputedStyle(document.documentElement);
    const ink = (name: string) => css.getPropertyValue(name).trim() || "#888888";
    const base = Math.round(h * 0.68);
    const up = base - 10;
    const down = h - base - 6;
    for (let i = drawn.current; i < s.posts.length; i += 1) {
      const post = s.posts[i];
      const x = 10 + ((post.atMs ?? 0) / total) * (w - 20);
      const lead = post.decision === "qualify" || post.decision === "review";
      const mag = Math.min(1, (post.score ?? 0) / 100);
      ctx.strokeStyle = ink(REL_VAR[post.relationship ?? "unknown"]);
      ctx.globalAlpha = lead ? 0.9 : 0.24;
      ctx.lineWidth = lead ? 1.6 : 1;
      const length = lead ? 12 + mag * (up - 26) : 8 + mag * (down - 8);
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, lead ? base - length : base + length);
      ctx.stroke();
      if (post.decision === "qualify") {
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink("--score-hot");
        ctx.beginPath();
        ctx.arc(x, base - length, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink("--border");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, base + 0.5);
    ctx.lineTo(w - 10, base + 0.5);
    ctx.stroke();
    drawn.current = s.posts.length;
  });

  const pct = Math.min(100, (s.elapsedMs / total) * 100);
  const marks: [number, string][] = [
    [s.marks.firstVerdictMs, `${fmtSecs(s.marks.firstVerdictMs)} first verdict`],
    [s.marks.firstPassMs, `${fmtSecs(s.marks.firstPassMs)} every search swept once`],
    [total, `${fmtSecs(total)} the whole year`],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[300px] w-full rounded-card border bg-surface">
        <canvas ref={ref} className="absolute inset-0 rounded-card" />
        <div
          className="absolute top-0 bottom-0 w-px transition-motion"
          style={{ left: `${pct}%`, background: "var(--fg)", opacity: s.phase === "done" ? 0 : 0.5 }}
        />
        <span className="absolute top-3 left-4 text-mono text-fg-muted">leads above the line</span>
        <span className="absolute bottom-3 left-4 text-mono text-fg-muted">read and set aside below it</span>
      </div>
      <div className="relative h-4">
        {marks.map(([ms, label], index) => (
          <span
            key={label}
            className="absolute top-0 whitespace-nowrap text-mono"
            style={{
              left: `${Math.min(100, (ms / total) * 100)}%`,
              transform: index === marks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
              color: s.elapsedMs >= ms ? "var(--fg)" : "var(--fg-muted)",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function VariantB({ s }: { s: SimState }) {
  const c = s.counts;
  const done = s.phase === "done";
  const shown = done ? best(s.posts, isLead) : (recentWhere(s.posts, isLead, 1)[0] ?? null);
  const hours = humanHours(c.judged);
  const perDollar = s.costUsd > 0 ? c.leads / s.costUsd : 0;
  return (
    <main className="min-h-screen bg-bg px-8 py-8 text-fg">
      <Motion />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>One backfill · every verdict on one trace</Eyebrow>
            <h1 className="text-h2" style={{ fontWeight: 500 }}>
              A year of Reddit, verdict by verdict
            </h1>
            <p className="text-small text-fg-muted">
              One mark per post: above the line if Jev qualified it, below if it read it and set it
              aside, coloured by who the person turned out to be.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <PhasePill s={s} />
            <span className="font-mono text-[40px] leading-none tabular-nums">{fmtSecs(s.elapsedMs)}</span>
          </div>
        </header>

        <div className="grid grid-cols-4 gap-3">
          <Stat
            label="Posts judged"
            value={fmtInt(c.judged)}
            note={`of ${fmtInt(c.found)} found · ${rateNote(s)}`}
          />
          <Stat label="Typed answers" value={fmtInt(s.judgments)} note="seven questions a post" />
          <Stat label="Hours of reading replaced" value={hours.toFixed(1)} unit="h" note="30s a post, by hand" />
          <Stat
            label="Jev spend"
            value={fmtUsd(s.costUsd)}
            accent
            note={perDollar > 0 ? `${fmtInt(perDollar)} leads per dollar` : "counting"}
          />
        </div>

        <Trace s={s} />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section className="flex flex-col gap-3">
            <Eyebrow>{done ? "The strongest lead of the year" : "The lead that just qualified"}</Eyebrow>
            {shown ? (
              <LeadCard key={shown.id} post={shown} />
            ) : (
              <div className="rounded-card border bg-surface p-6 text-small text-fg-muted">
                Nothing has qualified yet.
              </div>
            )}
          </section>
          <aside className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-card border bg-surface p-4">
              <Eyebrow>Read across the line</Eyebrow>
              <p className="text-small text-fg-muted">
                {s.elapsedMs >= s.marks.firstPassMs ? (
                  <>
                    By {fmtSecs(s.marks.firstPassMs)} every search had been swept once:
                    {" "}{fmtInt(s.marks.foundAtFirstPass)} posts found, {fmtInt(s.marks.judgedAtFirstPass)} judged,
                    {" "}{fmtInt(s.marks.leadsAtFirstPass)} leads already in the feed. The rest of the year kept
                    loading behind a feed you could already work.
                  </>
                ) : (
                  <>
                    The first sweep takes every search once, so the feed is worth opening long before the
                    year is finished.
                  </>
                )}
              </p>
            </div>
            <RelationshipSplit s={s} />
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ---------------- C: the sieve ---------------- */

/** The funnel, drawn at the real proportions of the run so far. */
function Sieve({ s }: { s: SimState }) {
  const c = s.counts;
  const top = Math.max(1, c.found);
  const buyers = c.byRelationship.buyer;
  const rows: [string, number, string][] = [
    ["turned up by the searches", c.found, "var(--surface-2)"],
    ["judged by Jev", c.judged, "color-mix(in oklch, var(--series-1) 22%, var(--surface))"],
    ["people who want to buy", buyers, "color-mix(in oklch, var(--score-hot) 28%, var(--surface))"],
    ["asking for what you sell", c.leads, "var(--score-hot)"],
  ];
  const width = (n: number) => (n === 0 ? 0 : Math.max(1.2, (n / top) * 100));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map(([label, n, fill], index) => {
        const wide = width(n);
        const nextWide = index + 1 < rows.length ? width(rows[index + 1][1]) : wide;
        const taper = wide === 0 ? 0 : (nextWide / wide) * 50;
        return (
          <div key={label} className="grid grid-cols-[1fr_minmax(0,56%)_1fr] items-center gap-3">
            <span className="text-right text-small text-fg-muted">{label}</span>
            <div className="relative h-[84px]">
              {wide === 0 ? null : <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-motion"
                style={{
                  width: `${wide}%`,
                  minWidth: 4,
                  background: fill,
                  borderRadius: "var(--radius-control)",
                  clipPath: `polygon(0 0, 100% 0, ${50 + taper}% 100%, ${50 - taper}% 100%)`,
                  border: `var(--hairline) solid var(--border)`,
                }}
              />}
            </div>
            <div className="flex flex-col">
              <span
                className="font-mono text-[22px] leading-none tabular-nums"
                style={index === rows.length - 1 ? { color: "var(--score-hot)" } : undefined}
              >
                {fmtInt(n)}
              </span>
              {index === 0 ? (
                <span className="text-mono text-fg-muted">every post the searches turned up</span>
              ) : (
                <span className="text-mono tabular-nums text-fg-muted">
                  {((n / top) * 100).toFixed(1)}% of everything found
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The seven questions, on whichever post Jev is holding this frame. */
function QuestionSheet({ post, settled }: { post: SimPost | null; settled: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border bg-surface p-4">
      <Eyebrow>
        {settled ? "What Jev asked of the strongest lead" : "The same seven questions, every post"}
      </Eyebrow>
      <p className="min-h-[38px] truncate text-small text-fg" style={{ fontWeight: 500 }}>
        {post?.title ?? "Waiting for the first post"}
      </p>
      <div className="flex flex-col">
        {(post?.answers ?? []).map((answer) => (
          <div
            key={answer.question}
            className="grid grid-cols-[110px_1fr] items-center gap-3 border-b py-1.5 last:border-b-0"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-mono text-fg-muted">{answer.question.replace(/_/g, " ")}</span>
            <span className="truncate text-mono text-fg">{answer.answer}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VariantC({ s }: { s: SimState }) {
  const c = s.counts;
  const hours = humanHours(c.judged);
  const done = s.phase === "done";
  const pool = recentWhere(s.posts, (p) => isLead(p) && Boolean(p.quote), 18);
  // Three at a time out of the newest leads, turning over every couple of
  // seconds, so a screenshot of any moment has three real sentences on it.
  const turn = Math.floor(s.elapsedMs / 2400);
  const cycling = pool.length <= 3 ? pool : [0, 1, 2].map((i) => pool[(turn * 3 + i) % pool.length]);
  const sheet = done ? best(s.posts, isLead) : s.current;
  const perDollar = s.costUsd > 0 ? c.leads / s.costUsd : 0;
  return (
    <main className="min-h-screen bg-bg px-8 py-8 text-fg">
      <Motion />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>A year of Reddit, sieved</Eyebrow>
            <h1 className="text-h2" style={{ fontWeight: 500 }}>
              {fmtInt(c.found)} posts in, {fmtInt(c.leads)} people asking
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <PhasePill s={s} />
            <span className="font-mono text-[40px] leading-none tabular-nums">{fmtSecs(s.elapsedMs)}</span>
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]">
          <section className="flex flex-col gap-5 rounded-frame border bg-surface p-6">
            <Sieve s={s} />
            <div className="h-px w-full" style={{ background: "var(--border)" }} />
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="text-small text-fg-muted">
                Reading {fmtInt(c.judged)} posts by hand, half a minute each, is
                {" "}
                <span className="font-mono text-fg tabular-nums">{hours.toFixed(1)} hours</span>.
              </span>
              <span className="text-small text-fg-muted">
                Jev did it in
                {" "}
                <span className="font-mono text-fg tabular-nums">{fmtSecs(s.elapsedMs)}</span>
                {" for "}
                <span className="font-mono tabular-nums" style={{ color: "var(--score-hot)" }}>
                  {fmtUsd(s.costUsd)}
                </span>
                {perDollar > 0 ? ` · ${fmtInt(perDollar)} leads per dollar` : ""}.
              </span>
            </div>
          </section>

          <aside className="flex flex-col gap-3">
            <QuestionSheet post={sheet} settled={done} />
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Communities read" value={fmtInt(c.subreddits)} />
              <Stat label="Typed answers" value={fmtInt(s.judgments)} note="two at triage, five at scoring" />
            </div>
          </aside>
        </div>

        <section className="flex flex-col gap-3">
          <Eyebrow>In their own words · what the qualified ones actually wrote</Eyebrow>
          <div className="grid gap-3 md:grid-cols-3">
            {cycling.length === 0 ? (
              [0, 1, 2].map((slot) => (
                <div
                  key={slot}
                  className="flex min-h-[112px] items-center rounded-card border bg-surface p-4 text-small text-fg-muted"
                >
                  Waiting for the first verdict.
                </div>
              ))
            ) : (
              cycling.map((post) => (
                <div key={post.id} className="lurk-fade flex flex-col gap-2.5 rounded-card border bg-surface p-4">
                  <Quote text={post.quote ?? ""} />
                  <div className="flex flex-wrap items-center gap-2">
                    <SubChip name={post.subreddit} />
                    <span className="text-mono text-fg-muted">
                      {post.monthsAgo === 0
                        ? "this month"
                        : `${post.monthsAgo} month${post.monthsAgo === 1 ? "" : "s"} back`}
                    </span>
                    <span className="text-mono" style={{ color: "var(--score-hot)" }}>
                      {INTENT_WORD[post.intent ?? 0]}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
