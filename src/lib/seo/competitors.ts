/**
 * Whether any competitor is named in a thread. A plain case-insensitive match
 * on the title and the body: a competitor written any way a redditor writes it
 * still counts, and the flag only ever tells the user where to read.
 */
export function competitorNamed(
  competitors: string[],
  title: string,
  body: string | null,
): boolean {
  const haystack = `${title}\n${body ?? ""}`.toLowerCase();
  return competitors.some((name) => {
    const needle = name.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * Which competitors are named in a thread, rather than only whether any is.
 * The stored flag answers the filter; this answers the reader looking at one
 * thread and asking who is already being talked about in it.
 */
export function namedCompetitors(
  competitors: string[],
  title: string,
  body: string | null,
): string[] {
  const haystack = `${title}\n${body ?? ""}`.toLowerCase();
  return competitors.filter((name) => {
    const needle = name.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}
