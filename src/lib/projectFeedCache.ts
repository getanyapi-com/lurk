/**
 * The last feed read each project answered with, kept in this process.
 *
 * Selecting a lead changes only the `?lead=` search param, and `RowLink` is a
 * real link, so choosing a row is a full server navigation that re-runs every
 * read behind the feed - the page of leads, the count, the faces, the facets,
 * the held pile and the scan report - to draw the same list back. Holding the
 * last read per project makes a selection cost nothing, because a selection
 * changes nothing that was read.
 *
 * One entry per project, replaced whenever that project reads under a
 * different filter, so a person moving through their own feed keeps exactly
 * the read they are looking at. A miss is only ever today's behaviour.
 *
 * It is deliberately not `unstable_cache`. Next serialises a cached value
 * through JSON, which turns every timestamp a feed row carries into a string;
 * `revalidateTag` throws outside a request, and the scan, backfill and rescore
 * that write leads all run in the scheduler with no request to be in.
 *
 * It is correct only because the app runs as one replica - `deploy.yml` pins
 * the container app to one, so that the image's migrations run once - which
 * makes this process the only one reading or writing these tables. A second
 * replica would serve a feed its own writes never invalidated, so the ceiling
 * below is what bounds how wrong it can be; anything scaling this app out has
 * to move the holder out of process before it does.
 */

/**
 * How long a held read may answer for, however quiet the project is.
 *
 * Every writer of what the feed reads drops the entry, so this is not what
 * keeps the list correct. What it bounds is the one thing no writer can
 * announce: the date window is bound when the read runs, so a project nobody
 * writes to would otherwise hold its "last 30 days" open until the next scan.
 * Long enough that clicking through a list of leads never re-reads, short
 * enough that a window is never visibly behind.
 */
export const FEED_HOLD_MS = 60_000;

type Held = { key: string; value: Promise<unknown>; at: number };

/**
 * Held on the process, not the module. Next bundles instrumentation, where the
 * scheduler lives, apart from the routes, so a module-level map came in two
 * copies: the sweep dropped the entry in its own and the leads page went on
 * answering from the other. On 2026-09-18 a finished sweep with 39 leads sat
 * over a feed that said "Leads 0" for that reason.
 */
const HOLDER = Symbol.for("lurk.projectFeedCache");
const holder = globalThis as { [HOLDER]?: Map<string, Held> };
const lastRead = (holder[HOLDER] ??= new Map<string, Held>());

/**
 * The value this project last answered `key` with, or a fresh read. The promise
 * itself is held, so two reads racing in one render share one round trip, and a
 * read that fails is forgotten rather than remembered as a failure.
 */
export function readProjectFeed<T>(
  projectId: string,
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  const held = lastRead.get(projectId);
  if (held && held.key === key && Date.now() - held.at < FEED_HOLD_MS) {
    return held.value as Promise<T>;
  }
  const value = read();
  lastRead.set(projectId, { key, value, at: Date.now() });
  void value.catch(() => {
    if (lastRead.get(projectId)?.value === value) {
      lastRead.delete(projectId);
    }
  });
  return value;
}

/** Drops what a project last answered, because something it reads has changed. */
export function forgetProjectFeed(projectIds: string | Iterable<string>): void {
  const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
  for (const id of ids) {
    lastRead.delete(id);
  }
}

/** Drops every held read. For tests, which need each one to start from nothing. */
export function forgetEveryProjectFeed(): void {
  lastRead.clear();
}
