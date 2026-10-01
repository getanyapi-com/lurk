/**
 * The plan states a scan retrieves every time: a row discovery promoted, or
 * one the owner pinned. A candidate is not read yet and an excluded row never
 * is. Keywords, communities and competitors all carry these states, and this
 * holds nothing server-side, so the Product page's editor and every query that
 * asks "is it being read" share the one list.
 */
export const RETRIEVED_STATES = ["active", "pinned"] as const;

export function isRetrieved(state: string): boolean {
  return (RETRIEVED_STATES as readonly string[]).includes(state);
}
