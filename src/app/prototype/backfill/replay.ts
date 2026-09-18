"use client";

/**
 * PROTOTYPE. Replays the recorded real backfill (recorded-run.json, exported
 * from a run on 2026-09-17: 3 keywords, 3 subreddits, 3,984 posts, 81s) from
 * page load, at real speed unless `speed` says otherwise. Every number on the
 * boards is the one the database showed at that moment of the run.
 */
import { useEffect, useState } from "react";
import recorded from "./recorded-run.json";
import type { Relationship, SimPost, SimState, Stage } from "./sim";

type Recorded = {
  totalMs: number;
  found: number;
  triageAt: number;
  search: { t: number; keyword: string; found: number }[];
  usage: { t: number; purpose: string; items: number; usd: number; ms: number }[];
  posts: {
    t: number; title: string; subreddit: string; monthsAgo: number; relationship: string; needState: string;
    decision: string; score: number; fit: number | null; intent: number | null; quote: string | null; stage: string | null;
  }[];
};

const RUN = recorded as Recorded;
const QUESTIONS_PER_ITEM: Record<string, number> = { triage: 2, score: 5, reading: 3 };
const RELS = ["buyer", "seller", "helper", "discussion", "unknown"];

const POSTS: SimPost[] = RUN.posts.map((p, index) => {
  const stage = (p.stage ?? "none") as Stage;
  const prob = (n: number | null, of: number) => (n == null ? 0.5 : 0.5 + (n / of) * 0.5);
  return {
    id: index,
    title: p.title,
    subreddit: p.subreddit,
    monthsAgo: p.monthsAgo,
    status: "judged",
    relationship: (RELS.includes(p.relationship) ? p.relationship : "unknown") as Relationship,
    stage,
    score: p.score,
    quote: p.quote ?? undefined,
    answers: [
      { question: "relationship", answer: p.relationship, p: 0.9 },
      { question: "need_state", answer: p.needState, p: 0.85 },
      { question: "need_quote", answer: p.quote ? "sentence" : "none", p: p.quote ? 0.8 : 0.9 },
      { question: "fit", answer: String(p.fit ?? "—"), p: prob(p.fit, 100) },
      { question: "intent", answer: String(p.intent ?? "—"), p: prob(p.intent, 100) },
      { question: "stage", answer: stage, p: 0.8 },
      { question: "decision", answer: p.decision, p: 0.9 },
    ],
  };
});

function at(elapsed: number, prevJudged: number): SimState {
  const search = RUN.search.filter((x) => x.t <= elapsed);
  const lastSearch = search[search.length - 1];
  const searching = elapsed < RUN.triageAt;
  const found = searching ? (lastSearch?.found ?? 0) : RUN.found;
  let judgedCount = 0;
  while (judgedCount < POSTS.length && RUN.posts[judgedCount].t <= elapsed) judgedCount++;
  const judged = POSTS.slice(0, judgedCount);
  const usage = RUN.usage.filter((u) => u.t <= elapsed);
  const judgments = usage.reduce((n, u) => n + u.items * (QUESTIONS_PER_ITEM[u.purpose] ?? 1), 0);
  const cost = usage.reduce((n, u) => n + u.usd, 0);
  const total = Math.max(found, judgedCount);
  const done = elapsed >= RUN.totalMs;
  // What triage set aside never reaches scoring; once the run is over those
  // tiles are settled, not waiting.
  const posts: SimPost[] = [
    ...judged,
    ...Array.from({ length: total - judgedCount }, (_, i) => ({
      id: judgedCount + i, title: "", subreddit: "", monthsAgo: 0, status: done ? ("triaged" as const) : ("found" as const),
    })),
  ];
  const batch = judged.slice(prevJudged);
  return {
    phase: done ? "done" : searching ? "searching" : judgedCount > 0 ? "scoring" : "triage",
    keyword: searching ? (lastSearch?.keyword ?? "") : "",
    posts,
    judgments,
    elapsedMs: Math.min(elapsed, RUN.totalMs),
    costUsd: cost,
    current: batch.length ? batch[batch.length - 1] : judged[judgedCount - 1] ?? null,
    lastBatch: batch,
  };
}

export function useReplay(speed = 1, enabled = true): SimState {
  const [state, setState] = useState<SimState>(() => at(0, 0));
  useEffect(() => {
    if (!enabled) return;
    const start = performance.now();
    let prevJudged = 0;
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) * speed;
      const next = at(elapsed, prevJudged);
      prevJudged = next.posts.filter((p) => p.status === "judged").length;
      setState((prev) => (next.lastBatch.length === 0 ? { ...next, lastBatch: prev.lastBatch, current: prev.current ?? next.current } : next));
      if (elapsed < RUN.totalMs + 500) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed, enabled]);
  return state;
}
