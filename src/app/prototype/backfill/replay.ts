"use client";

/**
 * PROTOTYPE. Replays the recorded real backfill (recorded-run.json) from page
 * load, at real speed unless `speed` says otherwise. Every number a board puts
 * on screen is the one the run actually had at that moment: the recording is
 * 22 searches over a year of Reddit, 4,229 posts found, 3,914 judged, done in
 * 62 seconds. Nothing here is a constant except how many typed questions one
 * item costs, which is a fact about Jev rather than about this run.
 */
import { useEffect, useState } from "react";
import recorded from "./recorded-run.json";
import {
  QUESTIONS_PER_ITEM, RELATIONSHIPS,
  type Counts, type Decision, type Marks, type Phase, type Relationship, type SimPost, type SimState, type Stage,
} from "./sim";

type Recorded = {
  recordedOn: string;
  totalMs: number;
  found: number;
  firstPassEndsAt: number;
  searchEndsAt: number;
  search: { t: number; phase: string; found: number }[];
  usage: { t: number; purpose: string; items: number; usd: number; ms: number }[];
  posts: {
    t: number; title: string; subreddit: string; monthsAgo: number; relationship: string; needState: string;
    decision: string; score: number; fit: number | null; intent: number | null; quote: string | null; stage: string | null;
  }[];
};

const RUN = recorded as Recorded;
const DECISIONS = ["qualify", "review", "reject"];

const POSTS: SimPost[] = RUN.posts.map((p, index) => {
  const stage = (p.stage ?? "none") as Stage;
  const prob = (n: number | null, of: number) => (n == null ? 0.5 : 0.5 + (n / of) * 0.5);
  return {
    id: index,
    title: p.title,
    subreddit: p.subreddit,
    monthsAgo: p.monthsAgo,
    status: "judged",
    atMs: p.t,
    relationship: (RELATIONSHIPS as readonly string[]).includes(p.relationship)
      ? (p.relationship as Relationship)
      : "unknown",
    needState: p.needState,
    stage,
    decision: (DECISIONS.includes(p.decision) ? p.decision : "reject") as Decision,
    score: p.score,
    fit: p.fit,
    intent: p.intent,
    quote: p.quote ?? undefined,
    answers: [
      { question: "relationship", answer: p.relationship, p: 0.9 },
      { question: "need_state", answer: p.needState, p: 0.85 },
      { question: "need_quote", answer: p.quote ? "sentence" : "none", p: p.quote ? 0.8 : 0.9 },
      { question: "fit", answer: String(p.fit ?? "-"), p: prob(p.fit, 4) },
      { question: "intent", answer: String(p.intent ?? "-"), p: prob(p.intent, 4) },
      { question: "stage", answer: stage, p: 0.8 },
      { question: "decision", answer: p.decision, p: 0.9 },
    ],
  };
});

/**
 * Every running total the boards ask for, worked out once per verdict rather
 * than recounted over 3,914 posts on every animation frame. Index i holds the
 * totals once the first i verdicts have landed.
 */
type Prefix = {
  leads: Int32Array;
  review: Int32Array;
  rejected: Int32Array;
  subreddits: Int32Array;
  byRelationship: Record<Relationship, Int32Array>;
};

const PREFIX: Prefix = (() => {
  const n = POSTS.length + 1;
  const leads = new Int32Array(n);
  const review = new Int32Array(n);
  const rejected = new Int32Array(n);
  const subreddits = new Int32Array(n);
  const byRelationship = Object.fromEntries(
    RELATIONSHIPS.map((r) => [r, new Int32Array(n)]),
  ) as Record<Relationship, Int32Array>;
  const seen = new Set<string>();
  for (let i = 0; i < POSTS.length; i += 1) {
    const post = POSTS[i];
    leads[i + 1] = leads[i] + (post.decision === "qualify" ? 1 : 0);
    review[i + 1] = review[i] + (post.decision === "review" ? 1 : 0);
    rejected[i + 1] = rejected[i] + (post.decision === "reject" ? 1 : 0);
    if (post.subreddit && !seen.has(post.subreddit)) seen.add(post.subreddit);
    subreddits[i + 1] = seen.size;
    for (const r of RELATIONSHIPS) {
      byRelationship[r][i + 1] = byRelationship[r][i] + (post.relationship === r ? 1 : 0);
    }
  }
  return { leads, review, rejected, subreddits, byRelationship };
})();

/** How many posts the searches had turned up, made monotonic. */
const FOUND_AT: number[] = (() => {
  let best = 0;
  return RUN.search.map((s) => {
    best = Math.max(best, s.found);
    return best;
  });
})();

const USAGE_ITEMS: number[] = [];
const USAGE_JUDGMENTS: number[] = [];
const USAGE_USD: number[] = [];
(() => {
  let items = 0;
  let judgments = 0;
  let usd = 0;
  for (const u of RUN.usage) {
    items += u.items;
    judgments += u.items * (QUESTIONS_PER_ITEM[u.purpose] ?? 1);
    usd += u.usd;
    USAGE_ITEMS.push(items);
    USAGE_JUDGMENTS.push(judgments);
    USAGE_USD.push(usd);
  }
})();

/** The last index whose time is at or before `elapsed`, or -1. */
function upTo(times: number[], elapsed: number): number {
  let low = 0;
  let high = times.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= elapsed) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

const POST_TIMES = RUN.posts.map((p) => p.t);
const SEARCH_TIMES = RUN.search.map((s) => s.t);
const USAGE_TIMES = RUN.usage.map((u) => u.t);

function countsAt(judgedCount: number, found: number): Counts {
  return {
    found: Math.max(found, judgedCount),
    judged: judgedCount,
    leads: PREFIX.leads[judgedCount],
    review: PREFIX.review[judgedCount],
    rejected: PREFIX.rejected[judgedCount],
    subreddits: PREFIX.subreddits[judgedCount],
    byRelationship: Object.fromEntries(
      RELATIONSHIPS.map((r) => [r, PREFIX.byRelationship[r][judgedCount]]),
    ) as Record<Relationship, number>,
  };
}

/** The whole story of the run, so a board can annotate what is coming. */
const MARKS: Marks = (() => {
  const firstPassIndex = Math.max(0, upTo(SEARCH_TIMES, RUN.firstPassEndsAt));
  const judgedAtFirstPass = upTo(POST_TIMES, RUN.firstPassEndsAt) + 1;
  return {
    firstVerdictMs: POST_TIMES[0] ?? 0,
    firstPassMs: RUN.firstPassEndsAt,
    searchEndMs: RUN.searchEndsAt,
    totalMs: RUN.totalMs,
    foundAtFirstPass: FOUND_AT[firstPassIndex] ?? 0,
    judgedAtFirstPass,
    leadsAtFirstPass: PREFIX.leads[judgedAtFirstPass],
  };
})();

export const RECORDED_ON = RUN.recordedOn;

/**
 * The phase is the run's own clock: the first sweep over every search, then
 * the rest of the year, then whatever judging outlives the searches.
 */
function phaseAt(elapsed: number): Phase {
  if (elapsed >= RUN.totalMs) return "done";
  if (elapsed < RUN.firstPassEndsAt) return "first";
  return elapsed < RUN.searchEndsAt ? "rest" : "scoring";
}

function at(elapsed: number, prevJudged: number): SimState {
  const searchIndex = upTo(SEARCH_TIMES, elapsed);
  const usageIndex = upTo(USAGE_TIMES, elapsed);
  const judgedCount = upTo(POST_TIMES, elapsed) + 1;
  const done = elapsed >= RUN.totalMs;
  const found = done ? RUN.found : searchIndex < 0 ? 0 : FOUND_AT[searchIndex];
  const posts = POSTS.slice(0, judgedCount);
  const batch = posts.slice(prevJudged);
  return {
    phase: phaseAt(elapsed),
    keyword: "",
    posts,
    counts: countsAt(judgedCount, found),
    marks: MARKS,
    items: usageIndex < 0 ? 0 : USAGE_ITEMS[usageIndex],
    judgments: usageIndex < 0 ? 0 : USAGE_JUDGMENTS[usageIndex],
    elapsedMs: Math.min(elapsed, RUN.totalMs),
    costUsd: usageIndex < 0 ? 0 : USAGE_USD[usageIndex],
    current: batch.length ? batch[batch.length - 1] : (posts[judgedCount - 1] ?? null),
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
      prevJudged = next.posts.length;
      setState((prev) => (
        next.lastBatch.length === 0
          ? { ...next, lastBatch: prev.lastBatch, current: prev.current ?? next.current }
          : next
      ));
      if (elapsed < RUN.totalMs + 500) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed, enabled]);
  return state;
}
