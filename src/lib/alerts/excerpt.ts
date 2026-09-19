/** Long enough to tell what the thread is about, short enough for five in one message. */
export const EXCERPT_CHARS = 280;

/** How much of the text before the phrase comes along when the excerpt opens mid-body. */
const LEAD_IN_CHARS = 80;

const GONE = new Set(["[removed]", "[deleted]"]);

function oneLine(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The author's own words for an alert: the opening of the body, or the stretch
 * around the matched phrase when that sits further in. Null when there is no
 * body to quote, a link post or a removed one.
 */
export function excerptOf(
  body: string | null | undefined,
  phrase: string | null | undefined,
  max = EXCERPT_CHARS,
): string | null {
  const text = oneLine(body);
  if (!text || GONE.has(text)) {
    return null;
  }
  if (text.length <= max) {
    return text;
  }
  const needle = oneLine(phrase);
  const at = needle ? text.indexOf(needle) : -1;
  let start = 0;
  if (at >= 0 && at + needle.length > max) {
    const from = Math.max(0, at - LEAD_IN_CHARS);
    const space = text.indexOf(" ", from);
    start = space >= 0 && space < at ? space + 1 : at;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > start ? space : end;
  }
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}
