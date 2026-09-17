import { competitorsNamed } from "@/lib/competitors/match";
import type { RankingThread } from "@/lib/seo/thread";

/**
 * What is true of a thread beyond its title, in small coloured words under it
 * rather than in bordered chips beside it.
 *
 * A chip is a thing you read; these are things you notice. Only the two that
 * change what you would do appear: that nobody can reply in it, and that a
 * rival is already being talked about in it.
 */
export function ThreadStatus({
  thread,
  competitors,
}: {
  thread: RankingThread;
  competitors: string[];
}) {
  const named = competitorsNamed(competitors, `${thread.title}\n${thread.body ?? ""}`);
  const closed = thread.isLocked ? "locked" : thread.isArchived ? "archived" : "closed";
  if (!thread.closed && !thread.competitorPresent) {
    return null;
  }
  return (
    <span className="flex flex-col text-mono">
      {thread.closed ? (
        <span className="text-reddit" title="Nobody can reply in it">
          {closed}
        </span>
      ) : null}
      {thread.competitorPresent ? (
        <span className="text-score-warm">
          {named.length > 0 ? `competitor (${named.join(", ")}) mentioned` : "competitor mentioned"}
        </span>
      ) : null}
    </span>
  );
}
