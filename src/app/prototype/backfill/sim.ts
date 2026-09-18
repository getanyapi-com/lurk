"use client";

/**
 * PROTOTYPE. The shape every board draws, plus a synthetic backfill that can
 * stand in for a recording when there is none to replay.
 *
 * The real thing is in replay.ts (the recorded run) and live.ts (a project
 * running right now). Both hand back a `SimState`, so a board never knows
 * which one it is drawing.
 */
import { useEffect, useRef, useState } from "react";

export const SUBREDDITS = [
  "smallbusiness", "Entrepreneur", "freelance", "salons", "personaltraining",
  "photography", "massage", "Therapists", "consulting", "coaching", "tutoring", "Dentistry",
];

export const RELATIONSHIPS = ["buyer", "seller", "helper", "discussion", "unknown"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const STAGES = ["none", "problem_aware", "solution_seeking", "comparing", "purchase_ready"] as const;
export type Stage = (typeof STAGES)[number];

/** What Jev decided about one post, which is what a lead is. */
export const DECISIONS = ["qualify", "review", "reject"] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * How many typed questions one item costs at each step of the pipeline. This
 * is the one number on the boards that is a fact about Jev rather than a fact
 * about the run, so it is a constant rather than something read back.
 */
export const QUESTIONS_PER_ITEM: Record<string, number> = { triage: 2, score: 5, reading: 3 };

export const QUESTIONS = [
  "relationship", "need_state", "need_quote", "fit", "intent", "stage", "decision",
] as const;

export type Answer = { question: string; answer: string; p: number };

export type SimPost = {
  id: number;
  title: string;
  subreddit: string;
  /** Months back from today, 0..12, so a timeline can place it in the year. */
  monthsAgo: number;
  status: "found" | "triaged" | "judged";
  /** When the verdict landed, in ms from the start of the job. */
  atMs?: number;
  relationship?: Relationship;
  needState?: string;
  stage?: Stage;
  decision?: Decision;
  score?: number;
  fit?: number | null;
  intent?: number | null;
  answers?: Answer[];
  quote?: string;
  ms?: number;
};

/**
 * Where the job is. The pipeline sweeps every search once ("first"), which is
 * what makes the feed useful, then walks the rest of the year ("rest"), then
 * finishes judging whatever is left over after the searches stop ("scoring").
 */
export type Phase = "idle" | "first" | "rest" | "scoring" | "done";

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "Waiting",
  first: "First pass over every search",
  rest: "Reading the rest of the year",
  scoring: "Judging what is left",
  done: "Done",
};

/** Everything a board would otherwise recount over thousands of posts. */
export type Counts = {
  found: number;
  judged: number;
  leads: number;
  review: number;
  rejected: number;
  subreddits: number;
  byRelationship: Record<Relationship, number>;
};

/** The moments of the run worth calling out, in ms from the start. */
export type Marks = {
  firstVerdictMs: number;
  firstPassMs: number;
  searchEndMs: number;
  totalMs: number;
  foundAtFirstPass: number;
  judgedAtFirstPass: number;
  leadsAtFirstPass: number;
};

export type SimState = {
  phase: Phase;
  /** Kept for the live reader, which still has a keyword to name. */
  keyword: string;
  /** Every post with a verdict, oldest verdict first. */
  posts: SimPost[];
  counts: Counts;
  marks: Marks;
  /** Items handed to Jev: a title at triage, then a post at scoring. */
  items: number;
  judgments: number;
  elapsedMs: number;
  costUsd: number;
  current: SimPost | null;
  lastBatch: SimPost[];
};

export const EMPTY_COUNTS: Counts = {
  found: 0, judged: 0, leads: 0, review: 0, rejected: 0, subreddits: 0,
  byRelationship: { buyer: 0, seller: 0, helper: 0, discussion: 0, unknown: 0 },
};

const TITLES: [string, Relationship, Stage][] = [
  ["Clients keep no-showing, is there a scheduler that takes deposits?", "buyer", "solution_seeking"],
  ["Calendly vs Acuity for a two-chair salon?", "buyer", "comparing"],
  ["Finally switched off paper books, what should I know", "buyer", "purchase_ready"],
  ["How do you all handle timezone mess with overseas clients", "buyer", "problem_aware"],
  ["We built a booking tool for trainers, AMA", "seller", "none"],
  ["Use Google Calendar appointment slots, it's free", "helper", "none"],
  ["Rant: double booked myself twice this week", "buyer", "problem_aware"],
  ["Anyone else find Square Appointments slow lately?", "buyer", "comparing"],
  ["Weekly wins thread", "discussion", "none"],
  ["Looking for something that syncs with Outlook and takes card on file", "buyer", "solution_seeking"],
  ["My assistant quit, need to automate intake before Monday", "buyer", "purchase_ready"],
  ["What's a fair cancellation policy?", "discussion", "none"],
  ["Free tool I made for group class signups", "seller", "none"],
  ["Is $30/mo normal for scheduling software?", "buyer", "comparing"],
  ["How I cut no-shows 40% (long)", "helper", "none"],
  ["Recommend a booking page that doesn't look like 2009", "buyer", "solution_seeking"],
  ["Trial ends Friday, torn between two apps", "buyer", "purchase_ready"],
  ["Do clients actually use the reschedule link?", "discussion", "none"],
  ["first month solo, what software do I actually need", "buyer", "problem_aware"],
  ["Acuity raised prices again", "buyer", "comparing"],
  ["Text reminders: worth it?", "buyer", "solution_seeking"],
  ["Migrating 400 clients out of Mindbody, tips?", "buyer", "purchase_ready"],
  ["Tutor here, 60 students, spreadsheets are killing me", "buyer", "solution_seeking"],
  ["Anyone tried the new Cal thing?", "buyer", "comparing"],
];

const QUOTES = [
  "is there a scheduler that takes deposits",
  "need to automate intake before Monday",
  "torn between two apps",
  "spreadsheets are killing me",
  "recommend a booking page",
  "tips on migrating 400 clients",
];

function rand(seed: { n: number }): number {
  seed.n = (seed.n * 1664525 + 1013904223) % 4294967296;
  return seed.n / 4294967296;
}

export const TOTAL_POSTS = 1712;
const COST_PER_JUDGMENT = 0.25 / (TOTAL_POSTS * 7);

function makePost(id: number, seed: { n: number }): SimPost {
  const [title, relationship, stage] = TITLES[Math.floor(rand(seed) * TITLES.length)];
  return {
    id,
    title,
    subreddit: SUBREDDITS[Math.floor(rand(seed) * SUBREDDITS.length)],
    monthsAgo: Math.min(12, Math.floor(rand(seed) * 13)),
    status: "found",
    relationship,
    stage,
  };
}

function judge(post: SimPost, seed: { n: number }, atMs: number): SimPost {
  const buyer = post.relationship === "buyer";
  const stageIndex = STAGES.indexOf(post.stage ?? "none");
  const base = buyer ? 45 + stageIndex * 12 : 5 + stageIndex * 4;
  const score = Math.max(0, Math.min(100, Math.round(base + (rand(seed) - 0.5) * 18)));
  const fit = buyer ? Math.min(4, 1 + Math.floor(stageIndex * 0.8)) : 0;
  const intent = buyer ? Math.min(4, stageIndex + 1) : 0;
  const decision: Decision = score >= 70 ? "qualify" : score >= 55 ? "review" : "reject";
  const p = () => 0.62 + rand(seed) * 0.36;
  const answers: Answer[] = [
    { question: "relationship", answer: post.relationship ?? "unknown", p: p() },
    { question: "need_state", answer: buyer ? "open" : "no_active_need", p: p() },
    { question: "need_quote", answer: buyer ? "sentence" : "none", p: p() },
    { question: "fit", answer: String(fit), p: p() },
    { question: "intent", answer: String(intent), p: p() },
    { question: "stage", answer: post.stage ?? "none", p: p() },
    { question: "decision", answer: decision, p: p() },
  ];
  return {
    ...post,
    status: "judged",
    atMs,
    needState: buyer ? "open" : "no_active_need",
    decision,
    score,
    fit,
    intent,
    answers,
    quote: buyer ? QUOTES[Math.floor(rand(seed) * QUOTES.length)] : undefined,
    ms: Math.round(140 + rand(seed) * 160),
  };
}

/** Recounts a whole run. Cheap enough for the synthetic sim's 1,700 posts. */
export function tally(posts: SimPost[], found: number): Counts {
  const byRelationship: Record<Relationship, number> = { buyer: 0, seller: 0, helper: 0, discussion: 0, unknown: 0 };
  const subs = new Set<string>();
  let judged = 0;
  let leads = 0;
  let review = 0;
  let rejected = 0;
  for (const post of posts) {
    if (post.status !== "judged") continue;
    judged += 1;
    byRelationship[post.relationship ?? "unknown"] += 1;
    if (post.subreddit) subs.add(post.subreddit);
    if (post.decision === "qualify") leads += 1;
    else if (post.decision === "review") review += 1;
    else rejected += 1;
  }
  return {
    found: Math.max(found, judged), judged, leads, review, rejected,
    subreddits: subs.size, byRelationship,
  };
}

const SIM_TOTAL_MS = 45000;
const SIM_FIRST_PASS_MS = 11000;

const IDLE: SimState = {
  phase: "idle",
  keyword: "",
  posts: [],
  counts: EMPTY_COUNTS,
  marks: {
    firstVerdictMs: 0, firstPassMs: SIM_FIRST_PASS_MS, searchEndMs: 19000, totalMs: SIM_TOTAL_MS,
    foundAtFirstPass: 0, judgedAtFirstPass: 0, leadsAtFirstPass: 0,
  },
  items: 0,
  judgments: 0,
  elapsedMs: 0,
  costUsd: 0,
  current: null,
  lastBatch: [],
};

/** Runs the compressed synthetic backfill from mount. `speed` 1 is ~45s. */
export function useBackfillSim(speed = 1): SimState {
  const [state, setState] = useState<SimState>(IDLE);
  const seed = useRef({ n: 7 });

  useEffect(() => {
    if (speed <= 0) return;
    const s = seed.current;
    const all: SimPost[] = [];
    let nextId = 0;
    let judgedTo = 0;
    let items = 0;
    let judgments = 0;
    let cost = 0;
    const start = performance.now();
    let cancelled = false;
    let marks = { ...IDLE.marks };
    const tick = () => {
      if (cancelled) return;
      const elapsed = (performance.now() - start) * speed;
      const target = Math.min(TOTAL_POSTS, Math.floor((elapsed / 19000) * TOTAL_POSTS));
      while (all.length < target) all.push(makePost(nextId++, s));
      const scoreTarget = Math.min(all.length, Math.floor(Math.max(0, elapsed - 3000) / 600) * 24);
      const batch: SimPost[] = [];
      while (judgedTo < scoreTarget) {
        all[judgedTo] = judge(all[judgedTo], s, elapsed);
        batch.push(all[judgedTo]);
        items += 2;
        judgments += QUESTIONS_PER_ITEM.triage + QUESTIONS_PER_ITEM.score;
        cost += COST_PER_JUDGMENT * 7;
        judgedTo += 1;
      }
      const judged = all.slice(0, judgedTo);
      const counts = tally(judged, all.length);
      if (marks.firstVerdictMs === 0 && judgedTo > 0) marks = { ...marks, firstVerdictMs: elapsed };
      if (marks.judgedAtFirstPass === 0 && elapsed >= SIM_FIRST_PASS_MS) {
        marks = { ...marks, foundAtFirstPass: counts.found, judgedAtFirstPass: counts.judged, leadsAtFirstPass: counts.leads };
      }
      const done = judgedTo >= TOTAL_POSTS;
      const phase: Phase = done
        ? "done"
        : elapsed < SIM_FIRST_PASS_MS ? "first" : all.length < TOTAL_POSTS ? "rest" : "scoring";
      setState((prev) => ({
        phase,
        keyword: "",
        posts: judged,
        counts,
        marks,
        items,
        judgments,
        elapsedMs: done && prev.phase === "done" ? prev.elapsedMs : elapsed,
        costUsd: cost,
        current: batch.length ? batch[batch.length - 1] : prev.current,
        lastBatch: batch.length ? batch : prev.lastBatch,
      }));
      if (!done) raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [speed]);

  return state;
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 0.1 ? 4 : 3)}`;
}
export function fmtSecs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
/** Typed questions answered per second. */
export function perSec(state: SimState): number {
  return state.elapsedMs > 500 ? state.judgments / (state.elapsedMs / 1000) : 0;
}
/** Items handed to Jev per second, which is the throughput it sustains. */
export function itemsPerSec(state: SimState): number {
  return state.elapsedMs > 500 ? state.items / (state.elapsedMs / 1000) : 0;
}
/** Posts given a verdict per second. */
export function postsPerSec(state: SimState): number {
  return state.elapsedMs > 500 ? state.counts.judged / (state.elapsedMs / 1000) : 0;
}
