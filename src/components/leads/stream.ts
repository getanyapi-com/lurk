import type { FeedRow, LeadFace } from "@/lib/feed";
import type { FeedLead } from "@/lib/leads";

/** One lead as the workspace shows it: the post or comment, and how it judged. */
export type CardLead = {
  id: string;
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

/** A run of faces whose need was posted on the same calendar day. */
export type StreamDay = { day: number; label: string; faces: LeadFace[] };

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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The same faces bucketed into days, newest day first, for the people strip.
 * The strip is a calendar, so it sorts by date whatever order the feed is in.
 */
export function groupByDay(faces: LeadFace[]): StreamDay[] {
  const days: StreamDay[] = [];
  const byDate = [...faces].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const face of byDate) {
    const day = startOfDay(face.at);
    const last = days.at(-1);
    if (last && last.day === day) {
      last.faces.push(face);
    } else {
      days.push({
        day,
        label: face.at.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        faces: [face],
      });
    }
  }
  return days;
}

/** The ring tone a lead's face wears in the strip, by its score band. */
export function scoreRing(score: number): string {
  return score >= 80 ? "ring-score-hot" : "ring-score-warm";
}
