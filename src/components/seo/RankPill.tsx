import { rankPoints } from "@/lib/seo/score";
import { cn } from "@/lib/utils";

/**
 * Where Google put the thread, as a tinted pill.
 *
 * The tint is the rank part of the score and nothing new: a position Google
 * still sends traffic to reads green, and one on the back half of page one
 * reads as plain as it performs. The two agree because they are the one
 * function, so a pill can never disagree with the number beside it.
 */
export function RankPill({ position }: { position: number | null }) {
  const worthSeeing = rankPoints(position) >= 2;
  return (
    <span
      title="Position in Google results"
      className={cn(
        // A fixed minimum, so a two-digit position does not shove the query
        // beside it out of line with every other row's.
        "inline-flex min-w-10 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-mono tabular-nums",
        worthSeeing ? "bg-score-hot/12 text-score-hot" : "bg-surface-2 text-fg-muted",
      )}
    >
      {position === null ? "unranked" : `#${position}`}
    </span>
  );
}
