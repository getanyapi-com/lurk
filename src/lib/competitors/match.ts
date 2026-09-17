/**
 * Which of a project's competitors a piece of text names. A plain
 * case-insensitive match: a competitor written any way a redditor writes it
 * still counts, and a false positive only ever tells the user where to read.
 * No model is asked; the list is the customer's and so is adding to it.
 */
export function competitorsNamed(competitors: string[], text: string): string[] {
  const haystack = text.toLowerCase();
  const seen = new Set<string>();
  return competitors.filter((name) => {
    const needle = name.trim().toLowerCase();
    if (needle.length === 0 || seen.has(needle) || !haystack.includes(needle)) {
      return false;
    }
    seen.add(needle);
    return true;
  });
}

/** Whether any competitor is named in a thread's own title and body. */
export function competitorNamed(competitors: string[], title: string, body: string | null): boolean {
  return competitorsNamed(competitors, `${title}\n${body ?? ""}`).length > 0;
}

/**
 * The sentence that named the competitor, as the card's evidence. Sentences
 * end at a full stop, a question or exclamation mark, or a line break; the
 * first one holding the name is the quote, trimmed to a card's worth.
 */
export const QUOTE_LIMIT = 280;

export function quoteNaming(text: string, name: string): string | null {
  const needle = name.trim().toLowerCase();
  if (needle.length === 0) {
    return null;
  }
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const clean = sentence.trim();
    if (clean.toLowerCase().includes(needle)) {
      return clean.length > QUOTE_LIMIT ? `${clean.slice(0, QUOTE_LIMIT - 1).trimEnd()}…` : clean;
    }
  }
  return null;
}
