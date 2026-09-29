/**
 * The X search lane grammar, checked before a lane spends anything.
 *
 * `malformedAlternatives`, `unboundOperators` and `repairQuery` are ported
 * from AnyAPI's eve-agent/lib/x-leads-lane.ts (513a21e73), held to the same
 * vectors (tests/fixtures/x-lane-vectors.json, from server/internal/xquery/
 * testdata). X ANDs bare adjacent words and binds OR tighter, so `(company
 * enrichment OR work email)` is word soup, not two phrases, and it binds an
 * operator trailing an unbracketed OR list to the last alternative only; the
 * gateway refuses both at no charge, and so does this, before the call.
 *
 * `assertLane` is lurk's own, stricter check: a lane lurk sends is one to
 * three AND groups, each a single word or quoted phrase or a parenthesized OR
 * of them, plus the tail operators lurk adds, and nothing else. Anything the
 * compiler did not mean to write is refused here, because on X a malformed
 * query is not an error, it is a billed page of the wrong posts.
 */

import { MAX_QUERY_CHARS } from "./constants";

/** Every alternative in the query that spans more than one bare word. Empty means it means what it says. */
export function malformedAlternatives(query: string): readonly string[] {
  const problems: string[] = [];
  scanLevel(query, problems);
  return [...new Set(problems)];
}

/**
 * Every operator trailing the last alternative of an unbracketed OR list, at
 * any level. X applies it to the last alternative only: `Jev OR "TypeSafe AI"
 * OR typesafe.ai -filter:replies` kept the replies matching the first two.
 */
export function unboundOperators(query: string): readonly string[] {
  const operators: string[] = [];
  scanTrailing(query, operators);
  return [...new Set(operators)];
}

/**
 * The query with each offending alternative quoted and each OR list with
 * unbound trailing operators bracketed. An alternative that already mixes a
 * quoted phrase with a bare word is left alone: what its author meant is not
 * recoverable.
 */
export function repairQuery(query: string): string {
  return bracketUnbound(
    malformedAlternatives(query)
      .filter((alternative) => !alternative.includes('"'))
      .reduce((current, alternative) => current.split(alternative).join(`"${alternative}"`), query),
  );
}

type Span = { start: number; end: number };

function scanTrailing(text: string, operators: string[]): void {
  const tokens = levelTokens(text);
  for (const token of tokens) {
    const body = groupBody(text.slice(token.start, token.end));
    if (body !== undefined) scanTrailing(body, operators);
  }
  for (const token of tokens.slice(unboundFrom(text, tokens))) {
    operators.push(text.slice(token.start, token.end));
  }
}

function bracketUnbound(text: string): string {
  const tokens = levelTokens(text);
  const from = unboundFrom(text, tokens);
  let out = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    out += text.slice(cursor, token.start);
    if (index === 0 && from < tokens.length) out += "(";
    let raw = text.slice(token.start, token.end);
    const body = groupBody(raw);
    if (body !== undefined) raw = `${raw.slice(0, raw.indexOf("(") + 1)}${bracketUnbound(body)})`;
    out += raw;
    if (index === from - 1 && from < tokens.length) out += ")";
    cursor = token.end;
  });
  return out + text.slice(cursor);
}

/** The index of the first unbound trailing operator at this level, or tokens.length for none. */
function unboundFrom(text: string, tokens: readonly Span[]): number {
  const words = tokens.map((token) => text.slice(token.start, token.end));
  const lastOr = words.lastIndexOf("OR");
  if (lastOr < 0) return tokens.length;
  let from = tokens.length;
  while (from > lastOr + 1 && isOperatorToken(words[from - 1] as string)) from -= 1;
  return from === tokens.length || from === lastOr + 1 ? tokens.length : from;
}

/** Splits one level on whitespace, keeping a quoted phrase and a whole group as single tokens. */
function levelTokens(text: string): Span[] {
  const tokens: Span[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (!quoted && depth === 0 && /\s/u.test(character)) {
      if (start >= 0) tokens.push({ start, end: index });
      start = -1;
      continue;
    }
    if (start < 0) start = index;
    if (character === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (character === "(") depth += 1;
    else if (character === ")" && depth > 0) depth -= 1;
  }
  if (start >= 0) tokens.push({ start, end: text.length });
  return tokens;
}

/** The inside of a token that is one whole, optionally negated, group: `(a)(b)` is two. */
function groupBody(token: string): string | undefined {
  const inner = token.startsWith("-") ? token.slice(1) : token;
  if (!inner.startsWith("(")) return undefined;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner.charAt(index);
    if (character === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index === inner.length - 1 ? inner.slice(1, index) : undefined;
    }
  }
  return undefined;
}

/** A search operator rather than a searched word. A URL's scheme is not an operator. */
function isOperatorToken(token: string): boolean {
  return /^-?[A-Za-z_][A-Za-z0-9_]*:/u.test(token) && !/^-?[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(token);
}

const GROUP_PLACEHOLDER = " ";

function scanLevel(text: string, problems: string[]): void {
  const { flattened, groups } = extractGroups(text);
  for (const group of groups) scanLevel(group, problems);
  if (!/(^|\s)OR(\s|$)/u.test(flattened)) return;
  for (const alternative of flattened.split(/(?:^|\s)OR(?:\s|$)/u)) {
    const words = tokenize(alternative).filter((token) => !isOperatorToken(token));
    if (words.length > 1) problems.push(words.join(" "));
  }
}

/** Replaces each top-level parenthesized group with an opaque token and returns the groups. */
function extractGroups(text: string): { flattened: string; groups: string[] } {
  const groups: string[] = [];
  let flattened = "";
  let depth = 0;
  let start = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === '"') quoted = !quoted;
    if (quoted) {
      if (depth === 0) flattened += character;
      continue;
    }
    if (character === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
      continue;
    }
    if (character === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        groups.push(text.slice(start, index));
        flattened += GROUP_PLACEHOLDER;
      }
      continue;
    }
    if (depth === 0) flattened += character;
  }
  return { flattened, groups };
}

/** Splits on whitespace, keeping a quoted phrase as one token. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (!quoted && /\s/u.test(character)) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/** Raised before any spend when a lane is not the shape lurk writes. */
export class XLaneRefusedError extends Error {
  constructor(
    readonly query: string,
    readonly why: string,
  ) {
    super(`Refused an X search before sending it (${why}): ${query}`);
    this.name = "XLaneRefusedError";
  }
}

/** Words that, as a whole OR alternative, match nearly every post on X. */
const NEGATION_WORDS = new Set(["not", "no", "cant", "can't", "without", "never", "dont", "don't", "wont"]);

/** Whether a lone word is one the guard refuses as a whole alternative, so a compiler can drop it rather than lose its lane. */
export function isRefusedLoneWord(word: string): boolean {
  return /^\d+$/u.test(word) || NEGATION_WORDS.has(word.toLowerCase());
}
/** A phrase longer than this is a sentence, and an exact-match sentence finds nobody. */
const MAX_PHRASE_WORDS = 6;
/** More AND groups than this and a lane matches nobody. */
export const MAX_GROUPS = 3;

const TAIL = /^(?: lang:[a-z]{2,3})?(?: -filter:retweets)?(?: -filter:replies)?(?: min_faves:[1-9]\d{0,4})?(?: since_time:\d{9,11})?$/u;
const KEYWORDS = new Set(["OR", "AND", "NOT", "or", "and", "not"]);
/**
 * One bare alternative: letters and digits, with an apostrophe or a hyphen
 * inside. Anything else (a dot, a plus, a slash) is quoted by the compiler, so
 * "context.dev" is a phrase, never a bare domain X reads its own way.
 */
const BARE_WORD = /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u;

/**
 * Throws unless the query is one to three AND groups followed only by the tail
 * lurk adds (`lang:xx`, `-filter:retweets`, `-filter:replies`,
 * `min_faves:<n>`, `since_time:<unix>`, in that order). A group is one alternative, or a parenthesized OR of alternatives;
 * an alternative is one bare word or one quoted phrase of at most six words.
 * That shape rules out, by construction, every trap the research found:
 * lowercase `or`, `AND`/`NOT` keywords, `to:`/`from:` or a filter anywhere but the tail, a
 * top-level OR that the tail binds to only one side, word-soup alternatives,
 * nested groups, and unbalanced quotes or parentheses.
 */
export function assertLane(query: string): void {
  if (query.length > MAX_QUERY_CHARS) {
    throw new XLaneRefusedError(query, `longer than ${MAX_QUERY_CHARS} characters`);
  }
  if ((query.match(/"/gu) ?? []).length % 2 !== 0) {
    throw new XLaneRefusedError(query, "unbalanced quotes");
  }
  if (malformedAlternatives(query).length > 0) {
    throw new XLaneRefusedError(query, "an OR alternative of several bare words");
  }
  if (unboundOperators(query).length > 0) {
    throw new XLaneRefusedError(query, "an operator bound to one OR alternative");
  }
  const tokens = levelTokens(query).map((span) => query.slice(span.start, span.end));
  let groups = 0;
  let index = 0;
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isOperatorToken(token)) break;
    const body = groupBody(token);
    if (body !== undefined) {
      if (token.startsWith("-")) {
        throw new XLaneRefusedError(query, "a negated group");
      }
      assertAlternatives(query, body, true);
    } else {
      assertAlternatives(query, token, false);
    }
    groups += 1;
  }
  if (groups === 0 || groups > MAX_GROUPS) {
    throw new XLaneRefusedError(query, `not one to ${MAX_GROUPS} groups`);
  }
  const tail = tokens.slice(index).join(" ");
  if (!TAIL.test(tail ? ` ${tail}` : "")) {
    throw new XLaneRefusedError(query, "an operator lurk does not send");
  }
}

/** One group's alternatives: inside parentheses an OR of them, outside exactly one. */
function assertAlternatives(query: string, text: string, grouped: boolean): void {
  const tokens = tokenize(text);
  const alternatives: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const expectsOr = index % 2 === 1;
    if (expectsOr) {
      if (token !== "OR" || !grouped) {
        throw new XLaneRefusedError(query, grouped ? "something other than alternatives joined by OR" : "an OR outside a group");
      }
      continue;
    }
    alternatives.push(token);
  }
  if (alternatives.length === 0 || tokens.length % 2 === 0) {
    throw new XLaneRefusedError(query, "an empty or dangling alternative");
  }
  for (const alternative of alternatives) {
    if (alternative.includes("(") || alternative.includes(")")) {
      throw new XLaneRefusedError(query, "nested groups");
    }
    const quoted = alternative.startsWith('"') && alternative.endsWith('"') && alternative.length > 2;
    const phrase = quoted ? alternative.slice(1, -1).trim() : alternative;
    if (!quoted && (KEYWORDS.has(phrase) || !BARE_WORD.test(phrase))) {
      throw new XLaneRefusedError(query, `a bare token lurk does not write: ${alternative}`);
    }
    if (quoted && /[A-Za-z0-9_]+:/u.test(phrase)) {
      throw new XLaneRefusedError(query, "an operator inside a phrase");
    }
    const words = phrase.split(/\s+/u);
    if (words.length > MAX_PHRASE_WORDS) {
      throw new XLaneRefusedError(query, `a phrase over ${MAX_PHRASE_WORDS} words`);
    }
    if (words.length === 1 && (/^\d+$/u.test(words[0]) || NEGATION_WORDS.has(words[0].toLowerCase()))) {
      throw new XLaneRefusedError(query, "a bare number or negation as an alternative");
    }
  }
}
