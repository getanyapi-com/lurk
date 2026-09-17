import { dayBounds, dayKey } from "@/lib/feed";

import type { FeedRow, FeedWindow, LeadFace } from "@/lib/feed";
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

/**
 * The same lead as one line in the list column. It is what crosses the wire
 * when the next page is fetched, so it carries what a row draws and not the
 * thread's body: the pane reads that from the server when a row is opened.
 */
export function toRow(lead: FeedLead): FeedRow {
  const card = toCard(lead);
  return {
    id: `lead-${card.id}`,
    title: card.title,
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How many columns the widest windows are drawn in. */
const COLUMNS = 30;

/** One column of the people strip: a slice of the window, and who posted in it. */
export type StreamColumn = {
  /** The moment the slice starts, in milliseconds. */
  at: number;
  /**
   * The calendar day this column is, when it is exactly one, and null when it
   * is not: an hour of a day already chosen, or a fortnight of an old backfill.
   * A column with a day is a column you can click to filter the feed to it.
   */
  day: string | null;
  /** The faces in the slice, best score first. */
  faces: LeadFace[];
};

/** One dated label under the strip, on the column it belongs to. */
export type StreamTick = { index: number; label: string };

/** The people strip as it is drawn: a fixed row of columns, and its axis. */
export type StreamTimeline = {
  columns: StreamColumn[];
  ticks: StreamTick[];
  /** Whether the last column is the one happening now, so its label can say so. */
  live: boolean;
};

/** The window the strip draws: the pills' own, narrowed to a day when one is picked. */
export type StripWindow = { days: FeedWindow; day?: string };

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The slice the column containing `now` ends on, so today is always drawn. */
function endOn(from: number, now: number, step: number): number {
  return from + Math.floor((now - from) / step) * step + step;
}

function oldestOf(faces: LeadFace[], fallback: number): number {
  return faces.reduce((oldest, face) => Math.min(oldest, face.at.getTime()), fallback);
}

/**
 * How one window is cut up: the width of a column, where the first one starts
 * and how many there are.
 *
 * A column is a day unless the window is already one day, and then it is an
 * hour. That is what makes the strip answer the question the feed is asking:
 * over a week or a month you want to know which day people asked on, and you
 * get the hour-by-hour reading of a day by picking that day.
 */
function shape(faces: LeadFace[], window: StripWindow, now: number) {
  if (window.day) {
    return { step: HOUR_MS, start: dayBounds(window.day).start.getTime(), count: 24 };
  }
  if (window.days === 1) {
    // Off the local day, not off the epoch: an hour is a named hour here, and
    // half-hour zones would have cut every column across two of them.
    const end = endOn(startOfDay(now), now, HOUR_MS);
    return { step: HOUR_MS, start: end - 24 * HOUR_MS, count: 24 };
  }
  const end = startOfDay(now) + DAY_MS;
  if (window.days !== "all") {
    return { step: DAY_MS, start: end - window.days * DAY_MS, count: window.days };
  }
  // All time is as long as the oldest lead, in whole days so the labels are
  // dates: a project with a year of backfill gets fortnight-wide columns.
  const span = Math.max(end - startOfDay(oldestOf(faces, now)), DAY_MS);
  const step = Math.max(Math.ceil(span / (COLUMNS * DAY_MS)), 1) * DAY_MS;
  // Never fewer than a week of columns: one lead on the day it arrived is a
  // strip of one column, and it drew that face alone in the middle of the card.
  const count = Math.max(Math.ceil(span / step), 7);
  return { step, start: end - count * step, count };
}

/**
 * What a tick says. A window of a day or two is read in hours and anything
 * longer in dates: a month of columns labelled by hour said nothing at all.
 */
function tickLabel(at: number, span: number): string {
  const date = new Date(at);
  if (span <= 2 * DAY_MS) {
    return date
      .toLocaleTimeString(undefined, { hour: "numeric" })
      .toLowerCase()
      .replace(/\s+/g, "");
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Five or so labels across the strip, always including both ends. The last one
 * is where the window runs out, and it is the one worth reading, so a tick that
 * would crowd it is dropped rather than drawn on top of it.
 */
function ticksOn(columns: StreamColumn[], step: number): StreamTick[] {
  const last = columns.length - 1;
  const every = Math.max(Math.round(last / 4), 1);
  const at: number[] = [];
  for (let index = 0; index < last; index += every) {
    at.push(index);
  }
  if (at.length > 1 && last - at[at.length - 1] < every / 2) {
    at.pop();
  }
  at.push(last);
  const span = columns.length * step;
  return at.map((index) => ({ index, label: tickLabel(columns[index].at, span) }));
}

/**
 * The faces laid along the window they were posted in, one column per slice of
 * it, oldest on the left. Empty slices are columns too: the strip is a clock,
 * and a quiet day has to take up the room it happened in rather than closing
 * the gap and reading as a busy one.
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
  const { step, start, count } = shape(faces, window, now);
  const columns: StreamColumn[] = Array.from({ length: count }, (_, index) => {
    const at = start + index * step;
    return { at, day: step === DAY_MS ? dayKey(new Date(at)) : null, faces: [] };
  });
  for (const face of faces) {
    const index = Math.floor((face.at.getTime() - start) / step);
    columns[Math.min(Math.max(index, 0), count - 1)].faces.push(face);
  }
  for (const column of columns) {
    column.faces.sort((a, b) => b.score - a.score);
  }
  const end = start + count * step;
  return { columns, ticks: ticksOn(columns, step), live: now >= end - step && now < end };
}

/**
 * The ring a face wears in the strip, or nothing. Only the hot band gets one:
 * sixty ringed faces in a row is a pattern rather than a signal, and what the
 * strip is for is spotting the few worth answering first.
 */
export function scoreRing(score: number): string | null {
  return score >= 80 ? "ring-2 ring-score-hot ring-offset-1 ring-offset-surface" : null;
}
