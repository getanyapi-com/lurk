import { plainTypography } from "@/lib/scan/evidence";

/**
 * Rival names as X lanes need them. X matches words exactly, so a name has to
 * be written the way people type it: lowercase (X search ignores case inside a
 * phrase), no punctuation that would break a quoted phrase, and never a word so
 * common that "alternative to <it>" reads as ordinary English.
 */

/** Words that, standing alone, stop a name from meaning anything on X. */
const NEGATIONS = new Set(["not", "no", "cant", "can't", "without", "never", "none"]);

/**
 * Product names that are also everyday English words. A rival named one of
 * these gets only the noun-bound templates ("alternative to notion"), never the
 * verb ones ("switching from notion"), which read as ordinary sentences. A
 * curated list rather than a dictionary: it only has to catch names people
 * actually compete with, and a miss costs one template, not a wrong lead.
 */
const COMMON_WORD_NAMES = new Set([
  "acuity", "airtable", "amplitude", "anchor", "asana", "basecamp", "beacon", "bench", "bolt", "bonsai",
  "box", "buffer", "canvas", "carrd", "chorus", "circle", "clay", "close", "coda", "copper",
  "craft", "dash", "drift", "dropbox", "echo", "envoy", "fathom", "flow", "folk", "forms",
  "fresh", "front", "gather", "ghost", "gong", "grain", "harvest", "height", "help", "hive",
  "honey", "hub", "intercom", "jasper", "keep", "kit", "lasso", "lattice", "lever", "linear",
  "loom", "loop", "mailchimp", "mercury", "metabase", "miro", "mode", "monday", "motion", "notion",
  "nova", "orbit", "outline", "paddle", "pilot", "pitch", "plaid", "planet", "podia", "pulse",
  "quill", "ramp", "reclaim", "relay", "rewind", "ripple", "rise", "rows", "sage", "salt",
  "scribe", "segment", "sendgrid", "shift", "signal", "slack", "slab", "snap", "spark", "sprout",
  "square", "stripe", "sunsama", "superhuman", "sway", "tally", "teachable", "things", "thinkific", "tide",
  "toggl", "trello", "unbounce", "vapi", "wave", "webflow", "wise", "workable", "zapier", "zoom",
]);

/**
 * A rival's name, cleaned for a quoted phrase, or null when it cannot make a
 * lane: empty, a single character, only digits, a negation, or longer than four
 * words (nobody types a five-word product name into a tweet).
 */
export function normalizeEntity(name: string): string | null {
  const cleaned = plainTypography(name)
    .replace(/["()#@:*]/gu, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  if (cleaned.length < 2 || /^\d+$/u.test(cleaned) || NEGATIONS.has(cleaned)) {
    return null;
  }
  if (cleaned.split(" ").length > 4) {
    return null;
  }
  return cleaned;
}

/** A one-word name that is also an everyday word, or so short it collides with one. */
export function isAmbiguous(entity: string): boolean {
  if (entity.includes(" ")) {
    return false;
  }
  return entity.length <= 3 || COMMON_WORD_NAMES.has(entity);
}

/** A name reduced to letters and digits, for comparing handles and names. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}
