"use client";

/**
 * PROTOTYPE. A client-side simulation of one year's backfill for a booking
 * product, shaped like the real pipeline (search walks per keyword, a title
 * triage, then batched typed judgements landing every few hundred ms) so the
 * four boards can be judged on how they show speed, not on what happens.
 * Numbers are sized to prod's real backfills: ~1,700 posts, ~10 questions
 * each, ~$0.25 of Jev. Wall time is compressed to ~45 seconds.
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

export const QUESTIONS = [
  "relationship", "need_state", "need_quote", "solves_problem", "hard_requirement",
  "audience", "intent", "stage", "asking", "not_buyer",
] as const;

export type Answer = { question: string; answer: string; p: number };

export type SimPost = {
  id: number;
  title: string;
  subreddit: string;
  /** Months back from today, 0..12, so a timeline can place it. */
  monthsAgo: number;
  status: "found" | "triaged" | "judged";
  relationship?: Relationship;
  stage?: Stage;
  score?: number;
  answers?: Answer[];
  quote?: string;
  ms?: number;
};

export type SimState = {
  phase: "idle" | "searching" | "triage" | "scoring" | "done";
  keyword: string;
  posts: SimPost[];
  judgments: number;
  elapsedMs: number;
  costUsd: number;
  current: SimPost | null;
  lastBatch: SimPost[];
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
  ["[Hiring] VA for appointment setting", "seller", "none"],
  ["Text reminders: worth it?", "buyer", "solution_seeking"],
  ["lol", "unknown", "none"],
  ["Migrating 400 clients out of Mindbody, tips?", "buyer", "purchase_ready"],
  ["Why do all these apps charge per staff seat", "buyer", "comparing"],
  ["Tutor here, 60 students, spreadsheets are killing me", "buyer", "solution_seeking"],
  ["Answer: use Zapier + Sheets, done", "helper", "none"],
  ["Anyone tried the new Cal thing?", "buyer", "comparing"],
];

const QUOTES = [
  "is there a scheduler that takes deposits",
  "need to automate intake before Monday",
  "torn between two apps",
  "spreadsheets are killing me",
  "Recommend a booking page",
  "tips on migrating 400 clients",
];

const KEYWORDS = [
  "appointment scheduling", "booking software", "no-show", "double booked",
  "calendly alternative", "acuity vs", "take deposits online", "client intake",
];

function rand(seed: { n: number }): number {
  seed.n = (seed.n * 1664525 + 1013904223) % 4294967296;
  return seed.n / 4294967296;
}

export const TOTAL_POSTS = 1712;
const COST_PER_JUDGMENT = 0.25 / (TOTAL_POSTS * QUESTIONS.length);

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

function judge(post: SimPost, seed: { n: number }): SimPost {
  const buyer = post.relationship === "buyer";
  const stageIndex = STAGES.indexOf(post.stage ?? "none");
  const base = buyer ? 45 + stageIndex * 12 : 5 + stageIndex * 4;
  const score = Math.max(0, Math.min(100, Math.round(base + (rand(seed) - 0.5) * 18)));
  const p = () => 0.62 + rand(seed) * 0.36;
  const answers: Answer[] = [
    { question: "relationship", answer: post.relationship ?? "unknown", p: p() },
    { question: "need_state", answer: buyer ? "open" : "none", p: p() },
    { question: "need_quote", answer: buyer ? "sentence 1" : "none", p: p() },
    { question: "solves_problem", answer: buyer ? "yes" : "no", p: p() },
    { question: "hard_requirement", answer: rand(seed) > 0.7 ? "yes" : "no", p: p() },
    { question: "audience", answer: buyer ? "yes" : "no", p: p() },
    { question: "intent", answer: String(Math.min(4, stageIndex + (buyer ? 1 : 0))) + " / 4", p: p() },
    { question: "stage", answer: post.stage ?? "none", p: p() },
    { question: "asking", answer: buyer && stageIndex >= 2 ? "yes" : "no", p: p() },
    { question: "not_buyer", answer: buyer ? "no" : "yes", p: p() },
  ];
  return {
    ...post,
    status: "judged",
    score,
    answers,
    quote: buyer ? QUOTES[Math.floor(rand(seed) * QUOTES.length)] : undefined,
    ms: Math.round(140 + rand(seed) * 160),
  };
}

const IDLE: SimState = {
  phase: "idle", keyword: "", posts: [], judgments: 0, elapsedMs: 0, costUsd: 0, current: null, lastBatch: [],
};

/** Runs the compressed backfill from mount. `speed` 1 is ~45s end to end. */
export function useBackfillSim(speed = 1): SimState {
  const [state, setState] = useState<SimState>(IDLE);
  const seed = useRef({ n: 7 });

  useEffect(() => {
    if (speed <= 0) return;
    const s = seed.current;
    const posts: SimPost[] = [];
    let nextId = 0;
    let judgedTo = 0;
    let triagedTo = 0;
    let judgments = 0;
    let cost = 0;
    const start = performance.now();
    let keywordIndex = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = (performance.now() - start) * speed;
      // Search: ~2.4s per keyword walk, posts arrive in bursts of a page.
      const searchDone = elapsed > 19000;
      if (!searchDone && posts.length < TOTAL_POSTS) {
        keywordIndex = Math.min(KEYWORDS.length - 1, Math.floor(elapsed / 2400));
        const target = Math.min(TOTAL_POSTS, Math.floor((elapsed / 19000) * TOTAL_POSTS));
        while (posts.length < target) posts.push(makePost(nextId++, s));
      }
      // Triage runs a beat behind search, in batches of 100 titles.
      const triageTarget = Math.min(posts.length, Math.floor(Math.max(0, elapsed - 1500) / 19000 * TOTAL_POSTS / 100) * 100);
      while (triagedTo < triageTarget) {
        posts[triagedTo] = { ...posts[triagedTo], status: "triaged" };
        judgments += 1; // one typed triage question per title
        cost += COST_PER_JUDGMENT;
        triagedTo++;
      }
      // Scoring: batches of ~24 every ~600ms, starting 3s in.
      const scoreTarget = Math.min(triagedTo, Math.floor(Math.max(0, elapsed - 3000) / 600) * 24);
      const batch: SimPost[] = [];
      while (judgedTo < scoreTarget) {
        posts[judgedTo] = judge(posts[judgedTo], s);
        batch.push(posts[judgedTo]);
        judgments += QUESTIONS.length;
        cost += COST_PER_JUDGMENT * QUESTIONS.length;
        judgedTo++;
      }
      const done = judgedTo >= TOTAL_POSTS;
      const phase: SimState["phase"] = done ? "done" : judgedTo > 0 ? "scoring" : triagedTo > 0 ? "triage" : "searching";
      setState((prev) => ({
        phase,
        keyword: KEYWORDS[keywordIndex],
        posts: [...posts],
        judgments,
        elapsedMs: done ? prev.phase === "done" ? prev.elapsedMs : elapsed : elapsed,
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
export function perSec(state: SimState): number {
  return state.elapsedMs > 500 ? state.judgments / (state.elapsedMs / 1000) : 0;
}
