"use client";

/* PROTOTYPE. Four boards over one simulation; see sim.ts. */
import { useRef } from "react";
import {
  fmtSecs, fmtUsd, perSec, RELATIONSHIPS, STAGES, TOTAL_POSTS,
  type Relationship, type SimPost, type SimState, type Stage,
} from "./sim";

const REL_COLOR: Record<Relationship, string> = {
  buyer: "var(--score-hot)",
  seller: "var(--reddit)",
  helper: "var(--series-1)",
  discussion: "var(--fg-muted)",
  unknown: "var(--border)",
};
const STAGE_LABEL: Record<Stage, string> = {
  none: "none", problem_aware: "problem aware", solution_seeking: "solution seeking",
  comparing: "comparing", purchase_ready: "purchase ready",
};

function Counter({ label, value, dark, unit }: { label: string; value: string; dark?: boolean; unit?: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-control border px-4 py-3"
      style={dark ? { background: "var(--fg)", color: "var(--bg)" } : { background: "var(--surface)" }}
    >
      <span className="font-mono text-[10px] uppercase tracking-widest opacity-60">{label}</span>
      <span className="font-mono text-[28px] leading-none tabular-nums">
        {value}
        {unit ? <span className="text-[14px] opacity-60">{unit}</span> : null}
      </span>
    </div>
  );
}

function Bars({ post }: { post: SimPost | null }) {
  if (!post?.answers) return <div className="text-small text-fg-muted">Waiting for the first batch…</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {post.answers.map((a) => (
        <div key={a.question} className="grid grid-cols-[120px_1fr_36px] items-center gap-2 font-mono text-[11px]">
          <span className="text-fg-muted">{a.question}</span>
          <div className="flex flex-col gap-0.5">
            <span className="text-fg">{a.answer}</span>
            <div className="h-1 w-full rounded-full" style={{ background: "var(--surface-2)" }}>
              <div className="h-1 rounded-full transition-all" style={{ width: `${a.p * 100}%`, background: "var(--fg)" }} />
            </div>
          </div>
          <span className="text-right text-fg-muted">{Math.round(a.p * 100)}%</span>
        </div>
      ))}
    </div>
  );
}


/* ---------------- A: the board ---------------- */
export function VariantA({ s }: { s: SimState }) {
  const judged = s.posts.filter((p) => p.status === "judged");
  const byStage = STAGES.map((st) => [st, judged.filter((p) => p.relationship === "buyer" && p.stage === st).length] as const);
  const byRel = RELATIONSHIPS.map((r) => [r, judged.filter((p) => p.relationship === r).length] as const);
  const hot = judged.filter((p) => (p.score ?? 0) >= 80).slice(-8).reverse();
  const max = Math.max(1, ...byStage.map(([, n]) => n), ...byRel.map(([, n]) => n));
  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-display" style={{ fontWeight: 600 }}>read the whole year</h1>
        <p className="font-mono text-mono text-fg-muted">a year of Reddit · every post, who is asking, and how close they are to buying</p>
      </div>
      <div className="grid grid-cols-6 gap-3">
        <Counter dark label="posts read" value={String(s.posts.length)} />
        <Counter dark label="typed judgments" value={s.judgments.toLocaleString()} />
        <Counter label="subreddits" value={String(new Set(s.posts.map((p) => p.subreddit)).size)} />
        <Counter label="judgments / sec" value={Math.round(perSec(s)).toString()} />
        <Counter label="elapsed" value={fmtSecs(s.elapsedMs)} />
        <Counter label="cost so far" value={fmtUsd(s.costUsd)} />
      </div>
      <div className="grid grid-cols-[1fr_420px] gap-3">
        <div className="rounded-card border bg-surface p-3">
          <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            <span>posts</span><span>{judged.length} / {s.posts.length}</span>
          </div>
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(64, 1fr)" }}>
            {Array.from({ length: Math.max(TOTAL_POSTS, s.posts.length) }, (_, i) => {
              const p = s.posts[i];
              const bg = !p ? "transparent" : p.status !== "judged" ? "var(--surface-2)" : REL_COLOR[p.relationship!];
              const op = p?.status === "judged" && p.relationship === "buyer" ? 0.35 + (p.score ?? 0) / 130 : 1;
              return <div key={i} className="aspect-square rounded-[1px]" style={{ background: bg, opacity: op }} />;
            })}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-card border bg-surface p-3">
            <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              <span>breakdown</span><span>{s.current?.ms ?? "—"} ms</span>
            </div>
            <p className="mb-1 text-body" style={{ fontWeight: 500 }}>{s.current?.title ?? "…"}</p>
            <p className="mb-3 font-mono text-[11px] text-fg-muted">r/{s.current?.subreddit}</p>
            <Bars post={s.current} />
          </div>
          <div className="rounded-card border bg-surface p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">the year</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                {byRel.map(([r, n]) => (
                  <div key={r} className="font-mono text-[11px]">
                    <div className="flex justify-between"><span>{r}</span><span className="text-fg-muted">{n}</span></div>
                    <div className="h-1" style={{ width: `${(n / max) * 100}%`, background: REL_COLOR[r] }} />
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {byStage.map(([st, n]) => (
                  <div key={st} className="font-mono text-[11px]">
                    <div className="flex justify-between"><span>{STAGE_LABEL[st]}</span><span className="text-fg-muted">{n}</span></div>
                    <div className="h-1" style={{ width: `${(n / max) * 100}%`, background: "var(--fg)" }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-card border bg-surface p-3">
        <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-fg-muted">
          <span>needs a human</span><span>{judged.filter((p) => (p.score ?? 0) >= 80).length}</span>
        </div>
        <div className="flex gap-2 overflow-hidden">
          {hot.map((p) => (
            <div key={p.id} className="w-56 shrink-0 rounded-control border p-2" style={{ borderColor: "var(--score-hot)" }}>
              <div className="font-mono text-[18px]" style={{ color: "var(--score-hot)" }}>{p.score}</div>
              <div className="truncate text-small">{p.title}</div>
              <div className="font-mono text-[10px] text-fg-muted">r/{p.subreddit} · {STAGE_LABEL[p.stage!]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- B: the stream ---------------- */
export function VariantB({ s }: { s: SimState }) {
  const judged = s.posts.filter((p) => p.status === "judged");
  const recent = judged.slice(-40).reverse();
  const leads = judged.filter((p) => (p.score ?? 0) >= 70).length;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="grid h-screen grid-cols-[1fr_380px]" style={{ background: "var(--fg)", color: "var(--bg)" }}>
      <div ref={ref} className="overflow-hidden p-6 font-mono text-[12px] leading-[1.7]">
        <div className="mb-4 opacity-50">$ lurk backfill --project bookline --window 1y</div>
        <div className="mb-1 opacity-70">
          {s.phase === "searching" || s.phase === "triage" ? `searching "${s.keyword}" …` : s.phase === "done" ? "done." : `scoring · batch of ${s.lastBatch.length}`}
        </div>
        {recent.map((p) => (
          <div key={p.id} className="grid grid-cols-[52px_84px_1fr_120px_56px] gap-3 whitespace-nowrap">
            <span style={{ color: (p.score ?? 0) >= 70 ? "var(--score-hot)" : "inherit", opacity: (p.score ?? 0) >= 70 ? 1 : 0.5 }}>
              {String(p.score).padStart(3, " ")}
            </span>
            <span style={{ color: REL_COLOR[p.relationship!] }}>{p.relationship}</span>
            <span className="truncate opacity-90">{p.title}</span>
            <span className="opacity-50">{STAGE_LABEL[p.stage!]}</span>
            <span className="text-right opacity-40">{p.ms}ms</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col justify-between border-l p-6" style={{ borderColor: "oklch(0.35 0 0)" }}>
        <div className="flex flex-col gap-6">
          <Big label="posts read" value={s.posts.length.toLocaleString()} />
          <Big label="judgments" value={s.judgments.toLocaleString()} />
          <Big label="per second" value={Math.round(perSec(s)).toLocaleString()} />
          <Big label="leads" value={String(leads)} accent />
        </div>
        <div className="flex flex-col gap-1 font-mono text-[12px] opacity-60">
          <div>{fmtSecs(s.elapsedMs)} elapsed</div>
          <div>{fmtUsd(s.costUsd)} in Jev</div>
          <div>{new Set(s.posts.map((p) => p.subreddit)).size} subreddits</div>
        </div>
      </div>
    </div>
  );
}
function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest opacity-50">{label}</div>
      <div className="font-mono text-[56px] leading-none tabular-nums" style={accent ? { color: "var(--score-hot)" } : undefined}>{value}</div>
    </div>
  );
}

/* ---------------- C: the sorter ---------------- */
export function VariantC({ s }: { s: SimState }) {
  const judged = s.posts.filter((p) => p.status === "judged");
  const buckets = RELATIONSHIPS.map((r) => ({ r, items: judged.filter((p) => p.relationship === r) }));
  const hot = judged.filter((p) => (p.score ?? 0) >= 80);
  const unjudged = s.posts.length - judged.length;
  return (
    <div className="flex h-screen flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-h2" style={{ fontWeight: 500 }}>{s.posts.length.toLocaleString()} posts found. {judged.length.toLocaleString()} sorted.</h1>
          <p className="text-small text-fg-muted">{fmtSecs(s.elapsedMs)} · {fmtUsd(s.costUsd)} · {Math.round(perSec(s))} judgments a second</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[48px] leading-none" style={{ color: "var(--score-hot)" }}>{hot.length}</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">worth a reply</div>
        </div>
      </div>
      <div className="rounded-card border bg-surface p-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted">inbox · {unjudged} waiting</div>
        <div className="flex h-8 flex-wrap gap-[2px] overflow-hidden">
          {Array.from({ length: Math.min(unjudged, 400) }).map((_, i) => (
            <div key={i} className="h-[6px] w-[6px] rounded-full" style={{ background: "var(--fg-muted)", opacity: 0.4 }} />
          ))}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-5 gap-3">
        {buckets.map(({ r, items }) => (
          <div key={r} className="flex flex-col rounded-card border bg-surface p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-body" style={{ fontWeight: 500, color: REL_COLOR[r] }}>{r}</span>
              <span className="font-mono text-[20px] tabular-nums">{items.length}</span>
            </div>
            <div className="flex flex-wrap content-start gap-[3px] overflow-hidden">
              {items.slice(-600).map((p) => (
                <div
                  key={p.id}
                  className="h-[9px] w-[9px] rounded-[2px]"
                  style={{
                    background: REL_COLOR[r],
                    opacity: r === "buyer" ? 0.25 + (p.score ?? 0) / 120 : 0.5,
                    outline: (p.score ?? 0) >= 80 ? "1px solid var(--fg)" : undefined,
                  }}
                />
              ))}
            </div>
            {r === "buyer" ? (
              <div className="mt-auto flex flex-col gap-1 pt-2">
                {STAGES.slice(1).map((st) => {
                  const n = items.filter((p) => p.stage === st).length;
                  return (
                    <div key={st} className="flex justify-between font-mono text-[11px]">
                      <span className="text-fg-muted">{STAGE_LABEL[st]}</span><span>{n}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex gap-2 overflow-hidden">
        {hot.slice(-6).reverse().map((p) => (
          <div key={p.id} className="w-64 shrink-0 rounded-control border bg-surface p-2">
            <div className="flex justify-between font-mono text-[11px]">
              <span style={{ color: "var(--score-hot)" }}>{p.score}</span><span className="text-fg-muted">r/{p.subreddit}</span>
            </div>
            <div className="truncate text-small">{p.title}</div>
            <div className="truncate font-mono text-[10px] text-fg-muted">“{p.quote}”</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- D: the year ---------------- */
export function VariantD({ s }: { s: SimState }) {
  const judged = s.posts.filter((p) => p.status === "judged");
  const months = Array.from({ length: 13 }, (_, i) => 12 - i);
  const label = (m: number) => {
    const d = new Date(2026, 8 - m, 1);
    return d.toLocaleString("en", { month: "short" }) + (d.getMonth() === 0 || m === 12 ? ` ${d.getFullYear().toString().slice(2)}` : "");
  };
  const leads = judged.filter((p) => (p.score ?? 0) >= 70);
  const maxCol = Math.max(1, ...months.map((m) => s.posts.filter((p) => p.monthsAgo === m).length));
  return (
    <div className="flex h-screen flex-col justify-between p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-display" style={{ fontWeight: 600 }}>
          {s.phase === "done" ? "A year of Reddit, read." : "Reading a year of Reddit…"}
        </h1>
        <div className="font-mono text-[14px] text-fg-muted">
          {s.posts.length.toLocaleString()} posts · {s.judgments.toLocaleString()} judgments · {fmtSecs(s.elapsedMs)} · {fmtUsd(s.costUsd)}
        </div>
      </div>
      <div className="flex flex-1 items-end gap-2 py-8">
        {months.map((m) => {
          const col = s.posts.filter((p) => p.monthsAgo === m);
          const colJudged = col.filter((p) => p.status === "judged");
          const colLeads = colJudged.filter((p) => (p.score ?? 0) >= 70);
          return (
            <div key={m} className="flex flex-1 flex-col items-stretch gap-1">
              <div className="flex flex-col-reverse gap-[2px]" style={{ height: 420 }}>
                <div className="rounded-t-sm transition-all" style={{ height: `${(col.length / maxCol) * 100}%`, background: "var(--surface-2)", position: "relative" }}>
                  <div className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-all" style={{ height: `${col.length ? (colJudged.length / col.length) * 100 : 0}%`, background: "var(--fg-muted)", opacity: 0.35 }} />
                  <div className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-all" style={{ height: `${col.length ? (colLeads.length / col.length) * 100 : 0}%`, background: "var(--score-hot)" }} />
                </div>
              </div>
              <div className="flex justify-between font-mono text-[10px] text-fg-muted">
                <span>{label(m)}</span><span>{colLeads.length ? colLeads.length : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-6">
        <Stat n={leads.length} label="people asking for what you sell" accent />
        <Stat n={judged.filter((p) => p.stage === "purchase_ready" && p.relationship === "buyer").length} label="about to buy" />
        <Stat n={judged.filter((p) => p.relationship === "seller").length} label="competitors pitching, skipped" />
      </div>
      <div className="mt-6 h-6 truncate font-mono text-[12px] text-fg-muted">
        {s.current ? `${s.current.score} · r/${s.current.subreddit} · ${s.current.title}` : ""}
      </div>
    </div>
  );
}
function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="rounded-card border bg-surface p-4">
      <div className="font-mono text-[44px] leading-none tabular-nums" style={accent ? { color: "var(--score-hot)" } : undefined}>{n.toLocaleString()}</div>
      <div className="mt-1 text-small text-fg-muted">{label}</div>
    </div>
  );
}
