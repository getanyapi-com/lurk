/**
 * The face Reddit gives an account that never chose one: one of eight coloured
 * Snoos. A profile lookup costs money and most leads never get one, so an
 * author we know nothing about is drawn as Reddit would draw them by default
 * rather than as two letters. Reddit picks by account id, which we do not
 * hold, so the pick here is by name: the same person is always the same Snoo.
 */
const DEFAULTS = 8;

export function defaultRedditAvatar(name: string | null): string {
  let hash = 0;
  for (const char of (name ?? "").toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  }
  return `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${hash % DEFAULTS}.png`;
}

/** The author's own picture when a lookup found one, and their default Snoo when not. */
export function redditAvatar(name: string | null, src: string | null | undefined): string {
  return src || defaultRedditAvatar(name);
}
