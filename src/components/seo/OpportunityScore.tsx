import {
  BAND_FILLS,
  BAND_TONES,
  BAND_WORDS,
  PART_LABELS,
  scoreBand,
  scoreSentence,
  type ScoreParts,
  type ThreadScore,
} from "@/lib/seo/score";
import { cn } from "@/lib/utils";

/**
 * What a ranking thread is worth replying in, as the number and the word for
 * it. The feed says its judgement in words alone, and deliberately: a lead's
 * fold is a sort order with a freshness clock inside it, so the number lied
 * about a three-day-old thread. This one holds no clock and measures one thing
 * a person can check, so it is shown, with the whole fold in its tooltip.
 */
export function OpportunityScore({
  scored,
  className,
}: {
  scored: ThreadScore;
  className?: string;
}) {
  const band = scoreBand(scored);
  return (
    <span
      className={cn(
        "inline-flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-control border bg-surface-2 px-1.5 py-1",
        className,
      )}
      title={scoreSentence(scored)}
    >
      <span className={cn("text-body tabular-nums", BAND_TONES[band])} style={{ fontWeight: 500 }}>
        {scored.score}
      </span>
      <span className="text-mono text-center leading-tight text-fg-muted">{BAND_WORDS[band]}</span>
    </span>
  );
}

/** The same number on one line, for a table cell and a list row. */
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

const STEPS = [1, 2, 3, 4];

/**
 * One part of the fold as four segments, coloured by the band the whole thread
 * landed in rather than by the part's own height: the parts are read together,
 * and a part that coloured itself would say a thread was hot on reach alone.
 */
function Part({ label, value, band }: { label: string; value: number; band: string }) {
  return (
    <span className="flex items-center justify-between gap-3" title={`${label} ${value} of 4`}>
      <span className="text-mono text-fg-muted">{label}</span>
      <span className="flex items-center gap-1" aria-label={`${label} ${value} of 4`}>
        {STEPS.map((step) => (
          <span
            key={step}
            className={cn("h-1.5 w-5 rounded-full", step <= value ? band : "bg-border")}
          />
        ))}
      </span>
    </span>
  );
}

/** Every part of the fold, so the number can always be taken apart. */
export function ScoreBreakdown({ scored }: { scored: ThreadScore }) {
  const fill = BAND_FILLS[scoreBand(scored)];
  return (
    <div className="flex flex-col gap-1.5">
      {(Object.keys(PART_LABELS) as (keyof ScoreParts)[]).map((part) => (
        <Part key={part} label={PART_LABELS[part]} value={scored.parts[part]} band={fill} />
      ))}
      {scored.unjudged ? (
        <span className="text-mono text-fg-muted">
          Nothing has judged who is asking here, so fit and intent count as nothing rather than
          having been looked at.
        </span>
      ) : null}
    </div>
  );
}
