import { fitWord, intentWord, judgementSentence } from "@/lib/scan/words";
import { cn } from "@/lib/utils";

type VerdictBadgeProps = { fit: number | null; intent: number | null; className?: string };

/**
 * The model's two answers about this person, in its own words.
 *
 * It used to be the folded score as a percent, and the fold is not a percent of
 * anything: a fifth of it is a freshness clock, so a thread the product fully
 * fits where someone is explicitly asking reads 70 once it is three days old.
 * The number is still the feed's sort order; it is no longer a claim shown to a
 * person. The colour keeps its old meaning and now hangs on intent, which is
 * what "hot" was ever about: an explicit near-term decision is hot, an explicit
 * ask is warm, everything else is cool.
 */
export function VerdictBadge({ fit, intent, className }: VerdictBadgeProps) {
  const tone =
    intent === 4 ? "text-score-hot" : intent === 3 ? "text-score-warm" : "text-score-cool";
  const words = [fitWord(fit), intentWord(intent)].filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  return (
    <span
      className={cn("text-small whitespace-nowrap", tone, className)}
      style={{ fontWeight: 500 }}
      // The rubric's own sentences, so the shorthand can always be checked.
      title={judgementSentence(fit, intent) ?? undefined}
    >
      {words.join(" / ")}
    </span>
  );
}
