import { atBounds, atKey, grainOf } from "@/lib/feed";

import type { FeedRow, FeedWindow, Grain, LeadFace } from "@/lib/feed";
import type { FeedLead } from "@/lib/leads";

/** One lead as the workspace shows it: the post or comment, and how it judged. */
export type CardLead = {
  id: string;
  /** The thread the lead sits in, its own post or the post its comment answers. */
  postId: string | null;
  score: number;
  fit: number | null;
  intent: number | null;
  engagement: number | null;
  stage: string | null;
  kind: string;
  reason: string | null;
  matchedPhrase: string | null;
  title: string;
  url: string;
  subreddit: string;
  subredditIconUrl: string | null;
  subredditWeeklyActive: number | null;
  promoPolicy: string | null;
  rulesText: string | null;
  imageUrl: string | null;
  numComments: number | null;
  points: number | null;
  createdAt: Date;
  body: string;
  author: string | null;
  avatarUrl: string | null;
  authorKarma: number | null;
  authorCreatedAt: Date | null;
  isComment: boolean;
  postAuthor: string | null;
  postAuthorAvatar: string | null;
};

/**
 * A lead as the feed reads it, as the card the workspace draws. A comment lead
 * is its comment throughout: its author, its age, its body and its permalink,
 * with the thread only underneath.
 */
export function toCard(lead: FeedLead): CardLead {
  const isComment = lead.commentId !== null;
  return {
    id: lead.id,
    postId: lead.postId,
    score: lead.score,
    fit: lead.fit,
    intent: lead.intent,
    engagement: lead.engagement,
    stage: lead.stage,
    kind: lead.kind,
    reason: lead.reason,
    matchedPhrase: lead.matchedPhrase,
    title: lead.title,
    url: (isComment ? lead.commentPermalink : lead.url) ?? lead.url,
    subreddit: lead.subreddit,
    subredditIconUrl: lead.subredditIconUrl,
    subredditWeeklyActive: lead.subredditWeeklyActive,
    promoPolicy: lead.promoPolicy,
    rulesText: lead.rulesText,
    imageUrl: isComment ? null : lead.imageUrl,
    numComments: lead.numComments,
    points: isComment ? lead.commentScore : lead.postScore,
    createdAt: (isComment ? lead.commentCreatedAt : lead.createdAt) ?? lead.createdAt,
    body: (isComment ? lead.commentBody : lead.body) ?? "",
    author: isComment ? lead.commentAuthor : lead.postAuthor,
    avatarUrl: lead.authorAvatar,
    authorKarma: lead.authorKarma,
    authorCreatedAt: lead.authorCreatedAt,
    isComment,
    postAuthor: lead.postAuthor,
    postAuthorAvatar: lead.postAuthorAvatar,
  };
}

/** As much of a comment as a row could ever show before it is cut off. */
const EXCERPT_LENGTH = 160;

/**
 * What a comment lead's row is headed by: the comment's own words on one line.
 * Headed by the thread's title, three comments in one thread were three rows
 * nobody could tell apart from each other or from the post.
 */
export function rowExcerpt(lead: Pick<CardLead, "isComment" | "body">): string | null {
  if (!lead.isComment) {
    return null;
  }
  const line = lead.body.replace(/\s+/g, " ").trim();
  return line ? line.slice(0, EXCERPT_LENGTH) : null;
}

/**
 * The same lead as one line in the list column. It is what crosses the wire
 * when the next page is fetched, so it carries what a row draws and not the
 * thread's body: the pane reads that from the server when a row is opened.
 */
export function toRow(lead: FeedLead): FeedRow {
  const card = toCard(lead);
  return {
    id: `lead-${card.id}`,
    postId: card.postId,
    title: card.title,
    excerpt: rowExcerpt(card),
    author: card.author,
    avatarUrl: card.avatarUrl,
    subreddit: card.subreddit,
    subredditIconUrl: card.subredditIconUrl,
    createdAt: card.createdAt,
    fit: card.fit,
    intent: card.intent,
  };
}

/** One thing in the feed: a lead the gates qualified. Nothing else. */
export type StreamEntry = { id: string; at: Date; lead: CardLead };

/**
 * The leads this project holds, best first, in the order the feed query gave
 * them: score, then how recently the need was posted. Freshness is already
 * half of that score, so sorting the stream by date on top of it threw fit and
 * intent away and opened the feed with whatever was newest. On 2026-09-10 that
 * was two crossposts of one person recruiting festival companions.
 *
 * Held candidates are deliberately not here either: they are the pile the scan
 * would not call either way, and four of them, warm-badged, sat above the first
 * real lead. They have their own group under the leads instead.
 */
export function buildStream(cards: CardLead[]): StreamEntry[] {
  return cards.map((lead): StreamEntry => ({ id: `lead-${lead.id}`, at: lead.createdAt, lead }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many columns the widest windows are drawn in. */
const COLUMNS = 31;

/** Past this many days, all time is read in months rather than in days. */
const MONTHS_OVER_DAYS = 62;

/** One column of the people strip: a slice of the window, and who posted in it. */
export type StreamColumn = {
  /** The moment the slice starts, in milliseconds. */
  at: number;
  /** The slice itself, as the URL writes it. Clicking the column filters to it. */
  key: string;
  /** What the slice is called on the axis, and in the hint when it is hovered. */
  label: string;
  /** The faces in the slice, best score first. */
  faces: LeadFace[];
};

/** One label under the strip, on the column it belongs to. */
export type StreamTick = {
  index: number;
  label: string;
  /** Whether it survives on a card too narrow to hold every label. */
  sparse: boolean;
};

/** The people strip as it is drawn: a fixed row of columns, and its axis. */
export type StreamTimeline = {
  columns: StreamColumn[];
  ticks: StreamTick[];
  /** What one column of this strip means, which is what clicking one filters to. */
  grain: Grain;
  /** Whether the last column is the one happening now, so its label can say so. */
  live: boolean;
};

/** The window the strip draws: the pills' own, narrowed to a slice when one is picked. */
export type StripWindow = { days: FeedWindow; at?: string };

/** The start of the slice `count` steps on from this one. */
function step(from: Date, grain: Grain, count: number): Date {
  const year = from.getFullYear();
  const month = from.getMonth();
  const date = from.getDate();
  if (grain === "month") {
    return new Date(year, month + count, 1);
  }
  if (grain === "day") {
    return new Date(year, month, date + count);
  }
  return new Date(year, month, date, from.getHours() + count);
}

/** The slice a moment sits in, as a date. */
function floorTo(at: Date, grain: Grain): Date {
  return atBounds(atKey(at, grain)).start;
}

function oldestOf(faces: LeadFace[], fallback: number): number {
  return faces.reduce((oldest, face) => Math.min(oldest, face.at.getTime()), fallback);
}

/**
 * How one window is cut up: what a column means, where the first one starts,
 * and how many there are.
 *
 * A column is one step finer than the window it draws, so clicking one always
 * takes you somewhere new: a month of leads is drawn in days, a day of them in
 * hours, and a backfill reaching back a year is drawn in months. That is what
 * makes the strip answer the question the feed is asking rather than repeating
 * the pill above it.
 */
function shape(faces: LeadFace[], window: StripWindow, now: number): {
  grain: Grain;
  start: Date;
  count: number;
} {
  const picked = window.at ? grainOf(window.at) : null;
  if (picked === "month") {
    const { start, end } = atBounds(window.at as string);
    return { grain: "day", start, count: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
  }
  if (picked) {
    // A day or an hour of one: the day it belongs to, read hour by hour.
    return { grain: "hour", start: floorTo(atBounds(window.at as string).start, "day"), count: 24 };
  }
  if (window.days === 1) {
    // The last 24 hours, ending on the hour happening now.
    return { grain: "hour", start: step(floorTo(new Date(now), "hour"), "hour", -23), count: 24 };
  }
  const today = floorTo(new Date(now), "day");
  if (window.days !== "all") {
    return { grain: "day", start: step(today, "day", 1 - window.days), count: window.days };
  }
  const oldest = new Date(oldestOf(faces, now));
  const days = Math.round((today.getTime() - floorTo(oldest, "day").getTime()) / DAY_MS) + 1;
  if (days <= MONTHS_OVER_DAYS) {
    // Never fewer than a week of columns: one lead on the day it arrived drew
    // that face alone in the middle of the card.
    const count = Math.max(days, 7);
    return { grain: "day", start: step(today, "day", 1 - count), count };
  }
  const first = floorTo(oldest, "month");
  const months =
    (today.getFullYear() - first.getFullYear()) * 12 + today.getMonth() - first.getMonth() + 1;
  return { grain: "month", start: step(today, "month", 1 - Math.min(months, COLUMNS)), count: Math.min(months, COLUMNS) };
}

/** What a column is called, at the grain it is drawn in. */
function columnLabel(at: Date, grain: Grain): string {
  const date = at;
  if (grain === "hour") {
    return date
      .toLocaleTimeString(undefined, { hour: "numeric" })
      .toLowerCase()
      .replace(/\s+/g, "");
  }
  if (grain === "day") {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  // Four digits of year, because "Sep 25" beside "Sep 17" reads as a date.
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Evenly spaced column indexes, always both ends, never crowding the last. */
function series(last: number, every: number): number[] {
  const at: number[] = [];
  for (let index = 0; index < last; index += every) {
    at.push(index);
  }
  if (at.length > 1 && last - at[at.length - 1] < every / 2) {
    at.pop();
  }
  at.push(last);
  return at;
}

/**
 * The labels under the strip. Roughly one every eight columns is what a card
 * this wide holds, and a narrow one keeps every fourth of those: a reader who
 * has to count columns from "Aug 19" to find the seventh of September is
 * reading a chart with no axis on it.
 */
function ticksOn(columns: StreamColumn[]): StreamTick[] {
  const last = columns.length - 1;
  const at = series(last, Math.max(Math.round(last / 8), 1));
  // The narrow set is taken out of the wide one, so nothing is labelled on a
  // small card that a big one does not also label.
  const keep = Math.max(Math.round(at.length / 5), 1);
  return at.map((index, n) => ({
    index,
    label: columns[index].label,
    sparse: n % keep === 0 || n === at.length - 1,
  }));
}

/**
 * The faces laid along the window they were posted in, one column per slice of
 * it, newest on the left. Empty slices are columns too: the strip is a clock,
 * and a quiet day has to take up the room it happened in rather than closing
 * the gap and reading as a busy one.
 *
 * The columns are built oldest first, because that is the order a clock counts
 * in and the order every face is bucketed by, and handed back reversed, because
 * that is the order they are drawn in. What is happening now is what you came
 * to the page for, so it is the first thing under your eye rather than the last
 * thing at the far edge of the card.
 *
 * It is read from every lead in the window rather than from the rows on screen,
 * because the list holds one page: a day missing from here would read as a day
 * nobody asked, rather than a day you have not scrolled to.
 */
export function timeline(
  faces: LeadFace[],
  window: StripWindow,
  now = Date.now(),
): StreamTimeline {
  const { grain, start, count } = shape(faces, window, now);
  const columns: StreamColumn[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = step(start, grain, index);
    columns.push({
      at: at.getTime(),
      key: atKey(at, grain),
      label: columnLabel(at, grain),
      faces: [],
    });
  }
  const byKey = new Map(columns.map((column, index) => [column.key, index]));
  const end = step(start, grain, count).getTime();
  for (const face of faces) {
    // By key, so a month of 28 days and an hour a clock change repeats both
    // land where they were posted. Anything outside is held at the near end.
    const known = byKey.get(atKey(face.at, grain));
    const index =
      known ?? (face.at.getTime() < columns[0].at ? 0 : face.at.getTime() >= end ? count - 1 : null);
    if (index !== null) {
      columns[index].faces.push(face);
    }
  }
  for (const column of columns) {
    column.faces.sort((a, b) => b.score - a.score);
  }
  // Read off the chronological array, before it is turned around: "the last
  // column is the slice happening now" is a fact about the clock, not about
  // which end of the card it is drawn at.
  const live = now >= columns[count - 1].at && now < end;
  const drawn = columns.reverse();
  // The ticks index into the drawn order, so they are taken from it.
  return { columns: drawn, ticks: ticksOn(drawn), grain, live };
}

/**
 * The ring a face wears in the strip, or nothing. Only the hot band gets one:
 * sixty ringed faces in a row is a pattern rather than a signal, and what the
 * strip is for is spotting the few worth answering first.
 */
export function scoreRing(score: number): string | null {
  return score >= 80 ? "ring-2 ring-score-hot ring-offset-1 ring-offset-surface" : null;
}
