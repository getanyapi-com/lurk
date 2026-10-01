import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { projects, redditComments, redditPosts, xLeads, xPosts } from "@/db/schema";
import { DEFAULT_SCORE_THRESHOLD } from "@/lib/scan/constants";
import { FILTER_TERM_CAP, wordsOf } from "./filterWords";

/**
 * A project's own rules for which judged leads it wants, on top of the judge.
 * The judge decides whether someone is asking; these decide whether this user
 * cares, so a thread that shares the product's words without wanting it can be
 * kept out by name. Like the minimum score they are applied when leads are
 * read, never when they are scored: changing one changes the next page load
 * and the next alert, with no rescan and nothing deleted. The words a lead
 * must not mention are the project's keyword mutes (lib/mutes.ts), which an
 * alert's one-click links add to as well, so there is one such list.
 */
export type LeadFilters = {
  /** A lead must mention one of these, when there are any. */
  mustMention: string[];
  /** The least score a Reddit lead needs to be alerted; null is the house floor. */
  alertMinScore: number | null;
  /** The least score an X ask needs to show or be alerted; null is none. */
  xMinScore: number | null;
};

export const NO_FILTERS: LeadFilters = {
  mustMention: [],
  alertMinScore: null,
  xMinScore: null,
};

/** Below this a Reddit lead is in the feed and not worth a message, unless the project says otherwise. */
export const ALERT_SCORE_FLOOR = 55;

const score = z.number().int().min(0).max(100).nullable();

export const leadFiltersSchema = z.object({
  mustMention: z.array(z.string()).max(FILTER_TERM_CAP).default([]),
  alertMinScore: score.default(null),
  xMinScore: score.default(null),
});

/** What the jsonb column holds, or no filters when it holds nothing usable. */
export function parseLeadFilters(stored: unknown): LeadFilters {
  const parsed = leadFiltersSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : NO_FILTERS;
}

/**
 * The forms of a normalised term that still count as it: the term, and its
 * last word with a plural ending, so "invoice" finds "invoices", "fix" finds
 * "fixes" and "proxy" finds "proxies". A possessive needs none: "invoice's" is
 * already "invoice s". `formsSql` is the same list in Postgres.
 */
function formsOf(key: string): string[] {
  return [key, `${key}s`, `${key}es`, key.replace(/y$/, "ies")];
}

/** `formsOf` in Postgres, over a term already folded to words. */
export function formsSql(key: SQL): SQL {
  return sql`unnest(array[${key}, ${key} || 's', ${key} || 'es', regexp_replace(${key}, 'y$', 'ies')])`;
}

/** Whether `text` mentions `term` as whole words. The SQL below is this, in Postgres. */
export function mentions(text: string, term: string): boolean {
  const key = wordsOf(term);
  const haystack = ` ${wordsOf(text)} `;
  return key !== "" && formsOf(key).some((form) => haystack.includes(` ${form} `));
}

/** Whether a lead's text passes the words it must mention and the muted ones. */
export function passesWords(text: string, lists: { mustMention: string[]; muted: string[] }): boolean {
  if (lists.muted.some((term) => mentions(text, term))) {
    return false;
  }
  return lists.mustMention.length === 0 || lists.mustMention.some((term) => mentions(text, term));
}

/**
 * Postgres's `wordsOf`, for the required words here and the muted ones
 * (lib/mutes.ts). `[^[:alnum:]]` is `[^\p{L}\p{N}]` in a UTF-8 database,
 * and a normalised term holds only letters, digits and single spaces, so it
 * can sit inside a LIKE pattern with nothing to escape.
 */
export function wordsSql(text: SQL): SQL {
  return sql`btrim(regexp_replace(lower(${text}), '[^[:alnum:]]+', ' ', 'g'))`;
}

/**
 * The words a lead must mention as a condition on a query that joins
 * `projects`. They are read off the row itself, so the feed, the X tab and
 * the digest all ask the same question without loading the filters first.
 */
export function wordsWhere(text: SQL): SQL {
  const haystack = sql`(' ' || ${wordsSql(text)} || ' ')`;
  const required = sql`coalesce(${projects.leadFilters} -> 'mustMention', '[]'::jsonb)`;
  return sql`(jsonb_array_length(${required}) = 0 or exists (
    select 1 from jsonb_array_elements_text(${required}) as term
    cross join lateral (select ${wordsSql(sql`term`)} as key) as normalised
    cross join lateral ${formsSql(sql`key`)} as form
    where key <> ''
      and ${haystack} like '% ' || form || ' %'
  ))`;
}

/**
 * What a Reddit lead is checked against: the thread's title and what the
 * lead's own author wrote, the same words a mute is checked against
 * (lib/mutes.ts). Needs `reddit_posts` and a left-joined `reddit_comments`.
 */
export function redditLeadWords(): SQL {
  return sql`${redditPosts.title} || ' ' || coalesce(${redditComments.body}, ${redditPosts.body}, '')`;
}

export function redditWordsWhere(): SQL {
  return wordsWhere(redditLeadWords());
}

/** What an X lead is checked against: the post's own text. */
export function xWordsWhere(): SQL {
  return wordsWhere(sql`${xPosts.text}`);
}

/** The feed's own floor on a Reddit lead: the project's minimum score, or the default. */
export const FEED_FLOOR_SQL = sql`coalesce(${projects.scoreThreshold}, ${DEFAULT_SCORE_THRESHOLD})`;

/**
 * The least score a Reddit lead needs to be alerted: the project's alert
 * floor or the house one, and never under the feed's, since a message should
 * not point at a lead the feed hides.
 */
export const ALERT_FLOOR_SQL = sql<number>`greatest(
  coalesce((${projects.leadFilters} ->> 'alertMinScore')::int, ${ALERT_SCORE_FLOOR}),
  ${FEED_FLOOR_SQL}
)`;

/** The least score an X ask needs, shown or alerted. No floor unless the project sets one. */
export const X_FLOOR_SQL = sql<number>`coalesce((${projects.leadFilters} ->> 'xMinScore')::int, 0)`;

/**
 * Whether the X tab shows a lead: its words pass, and an ask is at the
 * project's X floor. A reply is not scored the way an ask is, so the floor is
 * not asked of it. Needs `projects` and `x_posts` joined.
 */
export function xShownWhere(): SQL {
  return sql`(${xWordsWhere()} and (${xLeads.kind} <> 'ask' or ${xLeads.score} >= ${X_FLOOR_SQL}))`;
}
