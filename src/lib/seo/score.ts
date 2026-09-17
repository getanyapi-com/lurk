import type { RankingThread } from "./thread";

/**
 * What one ranking thread is worth replying in, as a number and its parts.
 *
 * The tab used to say nothing at all about better or worse. It grouped threads
 * under their phrasing, put the phrasings in alphabetical order, and left the
 * reader to open every card to find the one worth an afternoon. This is the
 * order it uses instead, and the number each view shows.
 *
 * Four parts, each on the 0-4 scale every other judgement in this product uses,
 * folded by weight the way `foldScore` folds a lead:
 *
 *   rank    3   where Google put it, which decides how many buyers ever see it
 *   intent  3   how ready the person in it is, the model's own answer
 *   fit     2   how well this product answers them, the model's own answer
 *   reach   1   how many people the thread pulls in on its own
 *
 * Rank and intent carry the most because the tab answers one question: will a
 * reply here be read by someone who wants what you sell. Fit weighs less than
 * it does on the leads feed, where it decides admission; here a thread ranks
 * whether it fits or not, and a near-fit thread at #1 is still worth a comment.
 *
 * Nothing here is a clock, and that is the deliberate difference from the feed.
 * A lead's fold spends a fifth of itself on freshness because a lead goes stale
 * in a day. A ranking thread is the opposite: it earns its place by ranking for
 * months, so a two-year-old thread at #1 is the best row on this page. A
 * freshness term would bury exactly the threads this tab exists to find.
 */
export const SCORE_WEIGHTS = { rank: 3, intent: 3, fit: 2, reach: 1 } as const;

/** Every part tops out at 4, so a perfect thread folds to this before scaling. */
const MAX_WEIGHTED =
  4 * (SCORE_WEIGHTS.rank + SCORE_WEIGHTS.intent + SCORE_WEIGHTS.fit + SCORE_WEIGHTS.reach);

/**
 * Where Google put the thread, 0-4. The steps are click-share shaped rather
 * than linear: the top result takes several times the clicks of the tenth, and
 * nothing past the first page is seen at all, so #1 is its own band and #11 is
 * worth the same as not ranking.
 */
export function rankPoints(position: number | null): number {
  if (position === null) {
    return 0;
  }
  if (position <= 1) {
    return 4;
  }
  if (position <= 3) {
    return 3;
  }
  if (position <= 6) {
    return 2;
  }
  return position <= 10 ? 1 : 0;
}

/**
 * How many people the thread pulls in on its own, 0-4: two for the upvotes it
 * carries and two for the conversation under it. It is the one part that is not
 * about the person posting, and it is weighted least, because a busy thread is
 * a busier place to be read as well as a better-seen one.
 */
export function reachPoints(score: number | null, numComments: number | null): number {
  const upvotes = score ?? 0;
  const replies = numComments ?? 0;
  const voted = upvotes >= 100 ? 2 : upvotes >= 20 ? 1 : 0;
  const talked = replies >= 25 ? 2 : replies >= 5 ? 1 : 0;
  return voted + talked;
}

export type ScoreParts = { rank: number; intent: number; fit: number; reach: number };

export type ThreadScore = {
  /** 0-100, and 0 for any closed thread whatever else is true of it. */
  score: number;
  parts: ScoreParts;
  /**
   * True when nothing has judged the person in the thread. A missing fit and a
   * missing intent both count as zero, the way the feed's fold counts them, and
   * this is what stops that zero reading as "we looked and there was nobody".
   */
  unjudged: boolean;
  closed: boolean;
};

/** What the score is folded from: any thread-shaped thing, for the tests too. */
export type Scorable = Pick<
  RankingThread,
  "position" | "fit" | "intent" | "score" | "numComments" | "closed"
>;

/**
 * One thread's score and the parts behind it. A closed thread scores zero
 * however well it ranks, because the score measures one thing - a reply being
 * read - and no reply is possible in a thread nobody can post to. The parts are
 * still computed and still shown, so a closed thread can be seen for what it
 * would have been worth.
 */
export function scoreThread(thread: Scorable): ThreadScore {
  const parts: ScoreParts = {
    rank: rankPoints(thread.position),
    intent: thread.intent ?? 0,
    fit: thread.fit ?? 0,
    reach: reachPoints(thread.score, thread.numComments),
  };
  const weighted =
    parts.rank * SCORE_WEIGHTS.rank +
    parts.intent * SCORE_WEIGHTS.intent +
    parts.fit * SCORE_WEIGHTS.fit +
    parts.reach * SCORE_WEIGHTS.reach;
  return {
    parts,
    unjudged: thread.fit === null && thread.intent === null,
    closed: thread.closed,
    score: thread.closed ? 0 : Math.round((weighted / MAX_WEIGHTED) * 100),
  };
}

/**
 * The three bands the number is read in, so a view can colour and name a score
 * without every view inventing its own cutoffs. A thread the product fits at a
 * position Google actually sends traffic to, with someone asking in it, lands
 * above 60; one on the back half of page one with nobody asking lands below 35.
 */
export const STRONG_SCORE = 60;
export const FAIR_SCORE = 35;

export type ScoreBand = "closed" | "strong" | "fair" | "weak";

export function scoreBand(scored: ThreadScore): ScoreBand {
  if (scored.closed) {
    return "closed";
  }
  if (scored.score >= STRONG_SCORE) {
    return "strong";
  }
  return scored.score >= FAIR_SCORE ? "fair" : "weak";
}

/** What each band is called, so the number always arrives with a word beside it. */
export const BAND_WORDS: Record<ScoreBand, string> = {
  closed: "Closed",
  strong: "Strong",
  fair: "Worth a look",
  weak: "Weak",
};

/** The same colours the leads feed uses for hot, warm and cool. */
export const BAND_TONES: Record<ScoreBand, string> = {
  closed: "text-fg-muted",
  strong: "text-score-hot",
  fair: "text-score-warm",
  weak: "text-score-cool",
};

/** And as a fill, for the bars and the badge backgrounds. */
export const BAND_FILLS: Record<ScoreBand, string> = {
  closed: "bg-border",
  strong: "bg-score-hot",
  fair: "bg-score-warm",
  weak: "bg-score-cool",
};

/** One thread with its score already folded, which is what every view draws. */
export type ScoredThread = RankingThread & { scored: ThreadScore };

export function scoreThreads(threads: RankingThread[]): ScoredThread[] {
  return threads.map((thread) => ({ ...thread, scored: scoreThread(thread) }));
}

/** The four part names, in the order they are weighted and always drawn. */
export const PART_LABELS: Record<keyof ScoreParts, string> = {
  rank: "Google rank",
  intent: "Buyer intent",
  fit: "Product fit",
  reach: "Reach",
};

/**
 * The whole fold in one sentence, for the tooltip on every number the tab
 * shows. A score with no way to check it is a number a person has to trust, and
 * this product does not ask that anywhere else.
 */
export function scoreSentence(scored: ThreadScore): string {
  if (scored.closed) {
    return "Archived or locked, so nobody can reply in it and it scores zero however well it ranks.";
  }
  const parts = (Object.keys(PART_LABELS) as (keyof ScoreParts)[])
    .map((part) => `${PART_LABELS[part].toLowerCase()} ${scored.parts[part]} of 4`)
    .join(", ");
  const caveat = scored.unjudged ? " Nothing has judged who is asking in it yet." : "";
  return `${scored.score} of 100, from ${parts}, weighted 3 / 3 / 2 / 1.${caveat}`;
}
