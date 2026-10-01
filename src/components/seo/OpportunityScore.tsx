import { BAND_TONES, BAND_WORDS, scoreBand, scoreSentence, type ThreadScore } from "@/lib/seo/score";
import { cn } from "@/lib/utils";

/**
 * What a ranking thread is worth replying in, as the number and the word for
 * it on one line, for a table cell and a list row. The feed says its judgement
 * in words alone, and deliberately: a lead's fold is a sort order with a
 * freshness clock inside it, so the number lied about a three-day-old thread.
 * This one holds no clock and measures one thing a person can check, so it is
 * shown, with the whole fold in its tooltip.
 */
export function InlineScore({ scored }: { scored: ThreadScore }) {
  const band = scoreBand(scored);
  return (
    <span
      className="inline-flex items-baseline gap-1.5 whitespace-nowrap"
      title={scoreSentence(scored)}
    >
      <span className={cn("text-small tabular-nums", BAND_TONES[band])} style={{ fontWeight: 500 }}>
        {scored.score}
      </span>
      <span className="text-mono text-fg-muted">{BAND_WORDS[band]}</span>
    </span>
  );
}
