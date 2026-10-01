/** One organic Google result, as google.search returns it. */
export type GoogleResult = {
  title?: string;
  link: string;
  snippet?: string;
  position: number;
};

/** A Reddit thread we can open: which community, which post, and its own URL. */
export type RedditThread = { subreddit: string; postId: string; canonicalUrl: string };

/**
 * Only a real thread on reddit.com itself counts. A mirror or an aggregator
 * that merely quotes a thread is not something reddit.post can open, and a
 * profile, a wiki page or a community's front page is not a thread at all, so
 * every one of those is dropped here rather than deeper in the scan.
 */
export function redditThread(raw: string): RedditThread | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "reddit.com" && !host.endsWith(".reddit.com")) {
    return null;
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts[0] !== "r" || parts[2] !== "comments") {
    return null;
  }
  const subreddit = parts[1];
  const postId = parts[3];
  if (!subreddit || !postId) {
    return null;
  }
  return {
    subreddit,
    postId,
    canonicalUrl: `https://www.reddit.com/r/${subreddit}/comments/${postId}/`,
  };
}

/** The Reddit threads among a page of Google results, in Google's order, each with its result. */
export function redditResults(
  results: GoogleResult[],
): { result: GoogleResult; thread: RedditThread }[] {
  return results.flatMap((result) => {
    const thread = redditThread(result.link ?? "");
    return thread ? [{ result, thread }] : [];
  });
}
