"use client";

/**
 * PROTOTYPE. The real backfill of one project, read every half second and
 * shaped like the simulation so the four boards draw it unchanged. Typed
 * judgments are items asked times the questions each step asks: two at
 * triage, five at scoring, three per reading.
 */
import { useEffect, useRef, useState } from "react";
import type { Relationship, SimPost, SimState, Stage } from "./sim";

const QUESTIONS_PER_ITEM: Record<string, number> = { triage: 2, score: 5, reading: 3 };

type Live = {
  job: { progress: string | null; startedAt: string | null; finishedAt: string | null; error: string | null } | null;
  usage: { purpose: string; calls: number; items: number; usd: number; ms: number }[];
  evaluations: {
    id: string; title: string; subreddit: string; createdAt: string; relationship: string;
    score: number; quote: string | null; reason: string; judgedAt: string; stage: string | null; kind: string | null;
    fit: number | null; intent: number | null; needState: string; decision: string;
  }[];
  found: number;
  leads: number;
  now: string;
};

const MONTH_MS = 30.4 * 24 * 3600 * 1000;

function asPost(e: Live["evaluations"][number], index: number): SimPost {
  const relationship = (["buyer", "seller", "helper", "discussion", "unknown"].includes(e.relationship)
    ? e.relationship
    : "unknown") as Relationship;
  const stage = (e.stage ?? "none") as Stage;
  const p = (n: number | null, of: number) => (n == null ? 0.5 : 0.5 + (n / of) * 0.5);
  return {
    id: index,
    title: e.title,
    subreddit: e.subreddit,
    monthsAgo: Math.min(12, Math.max(0, Math.floor((Date.now() - new Date(e.createdAt).getTime()) / MONTH_MS))),
    status: "judged",
    relationship,
    stage,
    score: e.score,
    quote: e.quote ?? undefined,
    ms: undefined,
    answers: [
      { question: "relationship", answer: e.relationship, p: 0.9 },
      { question: "need_state", answer: e.needState, p: 0.85 },
      { question: "need_quote", answer: e.quote ? "sentence" : "none", p: e.quote ? 0.8 : 0.9 },
      { question: "fit", answer: String(e.fit ?? "-"), p: p(e.fit, 100) },
      { question: "intent", answer: String(e.intent ?? "-"), p: p(e.intent, 100) },
      { question: "stage", answer: stage, p: 0.8 },
      { question: "decision", answer: e.decision, p: 0.9 },
    ],
  };
}

export function useLiveBackfill(projectId: string | null): SimState {
  const [state, setState] = useState<SimState>({
    phase: "idle", keyword: "", posts: [], judgments: 0, elapsedMs: 0, costUsd: 0, current: null, lastBatch: [],
  });
  const seen = useRef(0);
  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/prototype/backfill/live?project=${projectId}`, { cache: "no-store" });
        const live: Live = await res.json();
        const judgments = live.usage.reduce((n, u) => n + u.items * (QUESTIONS_PER_ITEM[u.purpose] ?? 1), 0);
        const cost = live.usage.reduce((n, u) => n + u.usd, 0);
        const progress = live.job?.progress ?? "";
        const searching = /^Searching/.test(progress);
        const foundInProgress = Number(/(\d+) posts found/.exec(progress)?.[1] ?? 0);
        const keyword = /Searching a year of "([^"]+)"/.exec(progress)?.[1] ?? "";
        const judged = live.evaluations.map(asPost);
        const total = Math.max(live.found, foundInProgress, judged.length);
        const posts: SimPost[] = [
          ...judged,
          ...Array.from({ length: total - judged.length }, (_, i) => ({
            id: judged.length + i, title: "", subreddit: "", monthsAgo: 0, status: "found" as const,
          })),
        ];
        const batch = judged.slice(seen.current);
        seen.current = judged.length;
        const started = live.job?.startedAt ? new Date(live.job.startedAt).getTime() : Date.now();
        const ended = live.job?.finishedAt ? new Date(live.job.finishedAt).getTime() : new Date(live.now).getTime();
        const done = Boolean(live.job?.finishedAt);
        setState((prev) => ({
          phase: done ? "done" : searching ? "searching" : judged.length > 0 ? "scoring" : total > 0 ? "triage" : "idle",
          keyword,
          posts,
          judgments,
          elapsedMs: ended - started,
          costUsd: cost,
          current: batch.length ? batch[batch.length - 1] : prev.current,
          lastBatch: batch.length ? batch : prev.lastBatch,
        }));
        if (!done && !stop) setTimeout(poll, 500);
      } catch {
        if (!stop) setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => { stop = true; };
  }, [projectId]);
  return state;
}
