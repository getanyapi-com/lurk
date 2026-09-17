import type { Relevance } from "@/lib/discovery/label";

/**
 * Everything the tab holds about one Reddit thread Google ranks for one of this
 * project's problem phrasings.
 *
 * It carries more than a card draws on purpose. The tab used to hand each card
 * a title, a rank and four counts, and every other fact the refresh had already
 * paid for - who is asking, how established they are, what the community allows,
 * what Google showed a searcher, what the model concluded - was reachable only
 * by leaving the app for Reddit. All of it is read in the one query now, so any
 * of the views can open a thread in place.
 */
export type RankingThread = {
  id: string;
  postId: string;
  position: number | null;
  competitorPresent: boolean;
  /** What this project judged the thread to hold, or null if nothing has. */
  verdict: Relevance | null;
  title: string;
  url: string;
  body: string | null;
  /** The phrasing Google was asked, which is the section this thread sits under. */
  keyword: string;
  /** What Google itself showed under the link for that phrasing. */
  snippet: string | null;
  subreddit: string;
  subredditIconUrl: string | null;
  subredditSubscribers: number | null;
  /** What the community says about promotion, and the rules that sentence came from. */
  promoPolicy: string | null;
  rulesText: string | null;
  author: string | null;
  authorAvatarUrl: string | null;
  authorKarma: number | null;
  authorCreatedAt: Date | null;
  score: number | null;
  numComments: number | null;
  createdAt: Date;
  /** Archived by Reddit or locked by a moderator: nobody can reply in it. */
  closed: boolean;
  /** Which of the two closed it, so the reason can be said rather than guessed. */
  isArchived: boolean | null;
  isLocked: boolean | null;
  /** What this project judged the person posting, or null if it never has. */
  fit: number | null;
  intent: number | null;
  /** When the refresh last saw Google rank this thread for this phrasing. */
  refreshedAt: Date;
};
