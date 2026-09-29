import { plainTypography } from "@/lib/scan/evidence";
import { MAX_TEXT_CHARS } from "./constants";
import type { XPost } from "./map";
import { ownWords } from "./map";
import { slug } from "./words";

/**
 * The free screen: deterministic rules that drop what no judge should be paid
 * to read. It runs once per project and post, before any LLM call.
 *
 * X's noise is not Reddit's. On 2026-09-27, lanes bound to a rival still came
 * back with vendors using buyer phrasing ("Looking for a Typeform alternative?
 * Youform gives you…"), listicles ("PAID VERSION → FREE ALTERNATIVE 1. …"),
 * freelancer spam ("Saw you're looking for a designer"), day-trader posts and
 * job ads. The mechanism is AnyAPI's (xleads/screen/free.go): ordered rules, a
 * word-start matcher, a free reject that is terminal. Its word and handle lists
 * are AnyAPI's own and are not copied. When in doubt a post passes; the pilot
 * holds every rule to keeping 95% of the posts Muse labels good (criterion C3).
 */

export type ScreenReason =
  | "stale"
  | "other_language"
  | "too_long"
  | "bare_link"
  | "own_or_rival_account"
  | "reply_farm"
  | "vendor_launch"
  | "machine_query"
  | "job_or_gig"
  | "trading_or_crypto"
  | "listicle"
  | "vendor_promo"
  | "vendor_hook"
  | "no_visible_term"
  | "no_ask";

export type ScreenInput = {
  post: XPost;
  /** The window's start; anything older is stale. */
  since: Date;
  /** The project's language, as X's lang codes. */
  lang: string;
  /** The project's own name and domain label: its own posts are not leads. */
  ownNames: string[];
  /** Every rival the project tracks, normalized: a rival's own account is not a lead. */
  rivals: string[];
  /**
   * The AND groups of the lane that found this post. A top-level post must
   * show an alternative of every group inside one sentence of its own words; a
   * reply, anywhere in what X returned, its leading @handles included. One
   * that does not matched on something the reader never sees: a username, a
   * link card, a quoted post, or words sentences apart.
   */
  laneTerms: string[][];
  /** How many separate conversations this post's author has posts in on the same search page: three or more is a farm. */
  authorPostsOnPage?: number;
  /** A finance or crypto product, whose buyers write cashtags. */
  financeProduct?: boolean;
  /** Pilot arm: also drop top-level posts with no ask in them. */
  requireAsk?: boolean;
  /**
   * The lane is a venue (build-vs-buy, workflow): its posts are read for being
   * worth a reply, not for an ask. Their words may be sentences apart ("1)
   * apify - scrape tiktok by niche hashtags 2) claude drafts every email"), and
   * numbered steps are a workflow, not a listicle, so only a listicle headline
   * drops one.
   */
  venue?: boolean;
};

export type ScreenResult = { pass: true } | { pass: false; reason: ScreenReason };

/** X's codes for text with no language: undetermined, no text, media, links, hashtags, emoji. */
const NO_LANGUAGE = new Set(["und", "zxx", "qme", "qam", "qct", "qht", "qst", "art"]);

const JOB_OR_GIG = [
  "we're hiring", "we are hiring", "#hiring", "job alert", "apply now", "hire me",
  "for hire", "available for work", "available for hire", "open to opportunities", "saw you're looking for",
  "saw you are looking for", "dm me for", "i can help you with",
];

const VENDOR_PROMO = [
  "link in bio", "link-in-bio", "link's in bio", "link is in bio", "we just launched", "just launched our",
  "giveaway", "follow and rt", "follow & rt", "follow + rt", "follow and retweet", "like and retweet",
  "sign up now", "sign up today", "sign up free", "sign up for free", "use code", "check out our",
  "live on product hunt",
];

const TRADING_WORDS = ["entry", "bounce", "long", "short", "pump", "tp", "sl", "breakout", "calls", "puts"];
const CRYPTO_PHRASES = ["presale", "memecoin", "not financial advice", "nfa"];
/** "airdrop" alone is also Apple's AirDrop; it is crypto only beside a coin word. */
const AIRDROP_COMPANIONS = ["wallet", "token", "tokens", "claim", "whitelist", "mint"];

const HOOK_OPENERS = /^(looking for|need|want|searching for|tired of|struggling with)\b/u;
const FIRST_PERSON = /\b(i|i'm|im|i've|i'd|i'll|my|me|we|we're|our|us)\b/u;
const HOOK_TELLS = ["gives you", "lets you", "meet ", "introducing", "built for", "free demo", "read the guide", "get started", "try it"];

const ASK_MARKERS = [
  "looking for", "anyone use", "anyone using", "anyone tried", "anyone recommend", "anyone know",
  "any recommendations", "any suggestions", "any alternative", "recommend", "suggestions", "need a",
  "need an", "is there a", "is there an", "is there any", "what do you use", "help me find",
  "switching from", "moving away from", "replace", "fed up with", "tired of",
];

const URL = /https?:\/\/\S+/gu;
const HANDLE = /@[A-Za-z0-9_]{1,15}/gu;
const CASHTAG = /\$[A-Za-z]{1,6}\b/gu;
const ENUMERATED_LINE = /^\s*(?:\d{1,2}[.)]|[-•→]|\d️?⃣)\s+\S/u;
const ARROW_PAIR = /\S\s*(?:->|→)\s*\S/gu;
/**
 * A listicle headline: "10 GitHub repos…", "here are 20 tools…", "top 5 apps…".
 * "Tried 3 alternatives to Notion" is somebody's experience, not a headline.
 */
const LISTICLE_TITLE =
  /(?:^\W{0,4}|\bhere (?:are|is) |\btop )\d{1,2}\s+(?:free |best |open[- ]source )?(?:tools|alternatives|apps|repos|github repos|sites|websites)\b/iu;

/** Lowercase, straight quotes, single spaces: the text the phrase rules read. */
export function normalizeText(text: string): string {
  return plainTypography(text).toLowerCase().replace(/\s+/gu, " ").trim();
}

/**
 * Whether a phrase starts at a word boundary in the text. The leading boundary
 * is required because a plain substring match read "your api" as "our api";
 * the trailing one is not, so "giveaway" still catches "giveaways".
 */
export function containsAtWordStart(text: string, phrase: string): boolean {
  let offset = 0;
  while (offset + phrase.length <= text.length) {
    const index = text.indexOf(phrase, offset);
    if (index < 0) {
      return false;
    }
    if (index === 0 || !/[\p{L}\p{N}]/u.test(text.charAt(index - 1))) {
      return true;
    }
    offset = index + 1;
  }
  return false;
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => containsAtWordStart(text, phrase));
}

/**
 * Three enumerated lines, two "A → B" pairs, or a "10 GitHub repos" headline,
 * unless the author asks something in the first person: a buyer listing what
 * they need ("I need: - round robin - Stripe - embeds. Any ideas?") is an ask.
 */
export function isListicle(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.includes("?") && FIRST_PERSON.test(normalized)) {
    return false;
  }
  // A buyer listing what they need ("looking for a CRM that has: 1. … 2. … 3. …")
  // asks before the list; a listicle opens with its headline.
  const opening = normalizeText(text.split(/\n/u).find((line) => line.trim().length > 0) ?? "");
  if (containsAny(opening, ASK_MARKERS)) {
    return false;
  }
  const enumerated = text.split(/\n/u).filter((line) => ENUMERATED_LINE.test(line)).length;
  if (enumerated >= 3) {
    return true;
  }
  if ((text.match(ARROW_PAIR) ?? []).length >= 2) {
    return true;
  }
  return LISTICLE_TITLE.test(text);
}

/**
 * A vendor dressed as a buyer: opens with a "looking for …?" question, never
 * speaks in the first person, and points somewhere. "Looking for a Typeform
 * alternative? Any ideas?" has no link and no pitch, so it stays.
 */
export function isVendorHook(text: string): boolean {
  const normalized = normalizeText(text);
  const first = normalized.split(/(?<=[?.!])\s|\n/u)[0] ?? "";
  if (!HOOK_OPENERS.test(first) || !first.endsWith("?")) {
    return false;
  }
  if (FIRST_PERSON.test(normalized)) {
    return false;
  }
  return /https?:\/\//u.test(text) || /(^|\s)#\w/u.test(text) || containsAny(normalized, HOOK_TELLS);
}

/** Whether the post's own words carry an ask. Only the pilot's no_ask arm reads it. */
export function hasAsk(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.includes("?") || containsAny(normalized, ASK_MARKERS);
}

function isTrading(text: string, normalized: string): boolean {
  const cashtags = (text.match(CASHTAG) ?? []).length;
  if (cashtags >= 2) {
    return true;
  }
  if (cashtags === 1 && containsAny(normalized, TRADING_WORDS)) {
    return true;
  }
  if (containsAny(normalized, ["airdrop"]) && (cashtags > 0 || containsAny(normalized, AIRDROP_COMPANIONS))) {
    return true;
  }
  return containsAny(normalized, CRYPTO_PHRASES);
}

/**
 * Text and terms as the visibility check compares them: lowercase, straight
 * quotes, and every run of characters other than letters, digits and
 * apostrophes one space, so "too-expensive" meets "too expensive" and "X-API"
 * meets "x api".
 */
export function fold(text: string): string {
  return normalizeText(text).replace(/[^\p{L}\p{N}']+/gu, " ").trim();
}

/** Abbreviations whose dot ends no sentence. */
const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|etc|vs|inc|co|ltd|mr|mrs|ms|dr|st|approx|no|fig)\.$/iu;

/**
 * A post's sentences: split after . ! ? or … and a space, and at line breaks.
 * A dot in "$0.48", a URL or "youcanbook.me" does not split, nor one ending
 * "e.g." or "vs.".
 */
export function sentencesOf(text: string): string[] {
  const pieces = plainTypography(text).split(/(?<=[.!?…])[^\S\n]+|\n+/u);
  const sentences: string[] = [];
  for (const piece of pieces) {
    const last = sentences.at(-1);
    if (last !== undefined && ABBREVIATION.test(last)) {
      sentences[sentences.length - 1] = `${last} ${piece}`;
    } else {
      sentences.push(piece);
    }
  }
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

/** The alternative of each group the folded text shows at a word start, or null when some group shows none. */
function visibleTerms(folded: string, terms: string[][]): string[] | null {
  const shown: string[] = [];
  for (const group of terms) {
    const hit = group.find((term) => {
      const wanted = fold(term);
      return wanted.length > 0 && containsAtWordStart(folded, wanted);
    });
    if (!hit) return null;
    shown.push(hit);
  }
  return shown;
}

/** The lane's words as the post shows them, by the rule for its kind (see ScreenInput.laneTerms and venue), or null. */
function shownTerms(post: XPost, terms: string[][], venue = false): string[] | null {
  if (post.isReply) {
    return visibleTerms(fold(post.text), terms);
  }
  if (venue) {
    return visibleTerms(fold(ownWords(post)), terms);
  }
  for (const sentence of sentencesOf(ownWords(post))) {
    const shown = visibleTerms(fold(sentence), terms);
    if (shown) return shown;
  }
  return null;
}

/**
 * "I built <Name> to…" in the first two sentences, with no ask anywhere: a
 * launch opening in the buyer's own words. One account wrote 36 of 327 posts
 * on 2026-09-27's live pages this way, each opening with the exact pain. The
 * name comes straight after the verb and is pitched ("to", "that", "for", a
 * dash or a colon), so "I built on Firecrawl and the pricing is brutal" or "we
 * built our MVP on Apify" is a builder, not a launch.
 */
const LAUNCH =
  /\b(?:I built|I'm building|I am building|We built|we built|We're building|we're building|Introducing|introducing)\s+[A-Z][\p{L}\p{N}]*(?:\s+[A-Z][\p{L}\p{N}]*){0,2}(?:\s*[\u2014\u2013:-]|\s+(?:to|that|for|which|so)\b)/u;

export function isVendorLaunch(text: string): boolean {
  const opening = sentencesOf(text).slice(0, 2).join(" ");
  return LAUNCH.test(opening) && !hasAsk(text);
}

/** Whether a post has words of its own to read, past its links and @handles: a bare link or an image with a caption of a few characters has none. */
export function hasOwnWords(post: Pick<XPost, "text" | "isReply">): boolean {
  return ownWords(post).replace(URL, "").replace(HANDLE, "").replace(/\s+/gu, "").length >= 12;
}

/** Whether the product itself or a tracked rival wrote the post: never a lead, whatever it says. */
export function isOwnOrRivalAccount(post: Pick<XPost, "authorUsername">, ownNames: string[], rivals: string[]): boolean {
  const accounts = [...ownNames, ...rivals].map(slug).filter((name) => name.length >= 3);
  return accounts.includes(slug(post.authorUsername));
}

/**
 * Screen reasons that say who wrote a reply, not what its thread is: a rival's
 * own account, a vendor pitching or a farm replying under someone's post. The
 * reply is never a lead, but the post it answers often is, since a vendor
 * replies where someone asked (run.ts judgeThread).
 */
export const PITCH_REASONS: ReadonlySet<ScreenReason> = new Set<ScreenReason>([
  "own_or_rival_account",
  "reply_farm",
  "vendor_promo",
  "vendor_hook",
  "vendor_launch",
]);

/** The first rule a post fails, in order, or a pass. */
export function freeScreen(input: ScreenInput): ScreenResult {
  const { post } = input;
  const own = ownWords(post);
  const normalized = normalizeText(own);
  const author = slug(post.authorUsername);

  if (post.createdAt < input.since) {
    return { pass: false, reason: "stale" };
  }
  if (post.lang && !NO_LANGUAGE.has(post.lang) && post.lang !== input.lang) {
    return { pass: false, reason: "other_language" };
  }
  if (post.text.length > MAX_TEXT_CHARS) {
    return { pass: false, reason: "too_long" };
  }
  if (!hasOwnWords(post)) {
    return { pass: false, reason: "bare_link" };
  }
  if (isOwnOrRivalAccount(post, input.ownNames, input.rivals)) {
    return { pass: false, reason: "own_or_rival_account" };
  }
  if ((input.authorPostsOnPage ?? 1) >= 3) {
    return { pass: false, reason: "reply_farm" };
  }
  if (author === "grok" || containsAtWordStart(post.text.toLowerCase(), "@grok")) {
    return { pass: false, reason: "machine_query" };
  }
  if (containsAny(normalized, JOB_OR_GIG)) {
    return { pass: false, reason: "job_or_gig" };
  }
  if (!input.financeProduct && isTrading(own, normalized)) {
    return { pass: false, reason: "trading_or_crypto" };
  }
  if (input.venue ? LISTICLE_TITLE.test(own) : isListicle(own)) {
    return { pass: false, reason: "listicle" };
  }
  if (containsAny(normalized, VENDOR_PROMO) || normalized.includes("% off")) {
    return { pass: false, reason: "vendor_promo" };
  }
  if (isVendorHook(own)) {
    return { pass: false, reason: "vendor_hook" };
  }
  if (isVendorLaunch(own)) {
    return { pass: false, reason: "vendor_launch" };
  }
  if (input.laneTerms.length > 0 && !shownTerms(post, input.laneTerms, input.venue)) {
    return { pass: false, reason: "no_visible_term" };
  }
  if (input.requireAsk && !post.isReply && !hasAsk(own)) {
    return { pass: false, reason: "no_ask" };
  }
  return { pass: true };
}

/** The lane's words the post shows, one per group ("calendly · pricing"), which the tab calls what found it. */
export function matchedLaneTerms(post: XPost, terms: string[][], venue = false): string | null {
  const shown = shownTerms(post, terms, venue);
  return shown ? shown.join(" · ") : null;
}
