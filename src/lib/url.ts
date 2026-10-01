/**
 * A page's query string with some parameters changed, for a link that keeps
 * every filter the page is on but the ones it is about. A parameter left
 * empty, or changed to nothing, is dropped rather than written as `name=`.
 * The changed ones go last, in the order given, so the parameter a link is
 * about is the one at the end of it. No leading `?`, so the string can also be
 * handed to a fetch or used as a key.
 */
export function withParams(
  params: Record<string, string | undefined>,
  changes: Record<string, string | null | undefined> = {},
): string {
  const changed = new Set(Object.keys(changes));
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value && !changed.has(name)) {
      query.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(changes)) {
    if (value) {
      query.set(name, value);
    }
  }
  return query.toString();
}
