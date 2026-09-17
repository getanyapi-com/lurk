type MeterProps = {
  label: string;
  value: number | null;
  /** What this judgement actually asked and answered, for the hover. */
  hint?: string;
};

const STEPS = [1, 2, 3, 4];

/** The 0-4 judgement scale as four segments, coloured by how high it reached. */
function tone(value: number): string {
  if (value >= 3) {
    return "bg-score-hot";
  }
  return value >= 2 ? "bg-score-warm" : "bg-score-cool";
}

/**
 * One judgement (fit, intent or engagement) read as a filled bar, not a number.
 * A judgement the scan never made reads as a dash: an empty bar would say the
 * scan looked and scored it zero, which is a different fact.
 */
export function Meter({ label, value, hint }: MeterProps) {
  if (value === null) {
    return (
      <span className="flex items-center justify-between gap-2" title={hint}>
        <span className="text-mono text-fg-muted">{label}</span>
        <span className="text-mono text-fg-muted">-</span>
      </span>
    );
  }
  return (
    <span
      className="flex items-center justify-between gap-2"
      title={hint ?? `${label} ${value} of 4`}
    >
      <span className="text-mono text-fg-muted">{label}</span>
      <span className="flex items-center gap-1" aria-label={`${label} ${value} of 4`}>
        {STEPS.map((step) => (
          <span
            key={step}
            className={`h-1.5 w-5 rounded-full ${step <= value ? tone(value) : "bg-border"}`}
          />
        ))}
      </span>
    </span>
  );
}
