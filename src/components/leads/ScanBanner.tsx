import { CircleCheck } from "lucide-react";

/**
 * A scan that has just finished, as a banner in the lead colour rather than one
 * more grey line, so a person who looked away can tell it is over. Shared by
 * the Reddit sweep and the X tab's first look.
 */
export function ScanDone({ title, line }: { title: string; line: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-card border px-4 py-3"
      style={{
        borderColor: "color-mix(in oklch, var(--score-hot) 45%, transparent)",
        background: "color-mix(in oklch, var(--score-hot) 10%, var(--surface))",
        animation: "scanDone 600ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
      role="status"
    >
      <CircleCheck size={22} className="shrink-0" style={{ color: "var(--score-hot)" }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span style={{ fontWeight: 500 }}>{title}</span>
        <span className="text-small text-fg-muted">{line}</span>
      </div>
      <style>{"@keyframes scanDone { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; } }"}</style>
    </div>
  );
}

/** A scan still reading: a card with a pulsing dot, so it reads as work in progress. */
export function ScanRunning({ text }: { text: string }) {
  return (
    <div className="text-small flex items-center gap-3 rounded-card border bg-surface px-4 py-2.5" aria-live="polite">
      <span className="size-2 shrink-0 animate-scan-pulse rounded-full" style={{ background: "var(--score-warm)" }} />
      <span className="min-w-0 flex-1">{text}</span>
    </div>
  );
}
