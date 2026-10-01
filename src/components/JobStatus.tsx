import type { JobRow } from "@/jobs/enqueue";
import { errorSentence, relativeAge, relativeUntil } from "@/lib/format";

/** How one tab speaks of its own job, from "Scanning now" to "Next scan in 3h". */
export type JobWords = {
  /** The job's noun, as in "Next scan in 3h" and "No scan is scheduled". */
  noun: string;
  /** What it is doing while it runs, before its progress: "Scanning now". */
  running: string;
  /** How the last one that ended well reads, given how long ago: "Last scanned 3h ago." */
  finished: (job: JobRow, ago: string) => string;
  /** Before the reason the last one ended badly: "Last scan stopped". */
  stopped: string;
  /** Said until one has run at all. */
  never: string;
  /** The button that starts one, named when none is scheduled. */
  button: string;
};

type JobStatusProps = { last: JobRow | null; next: JobRow | null; words: JobWords };

function lastSentence(job: JobRow | null, words: JobWords): string | null {
  if (!job?.startedAt) {
    return null;
  }
  if (!job.finishedAt) {
    return job.progress ? `${words.running}: ${job.progress}` : `${words.running}.`;
  }
  if (job.error) {
    return `${words.stopped}: ${errorSentence(job.error)}`;
  }
  return words.finished(job, relativeAge(job.finishedAt));
}

function nextSentence(job: JobRow | null, words: JobWords): string {
  if (!job) {
    return `No ${words.noun} is scheduled. Press ${words.button}.`;
  }
  const until = relativeUntil(job.runAt);
  return until === "now" ? `The next ${words.noun} is due now.` : `Next ${words.noun} ${until}.`;
}

/** One plain line: what a tab's last job did, and when the next one runs. */
export function JobStatus({ last, next, words }: JobStatusProps) {
  const running = Boolean(last?.startedAt && !last.finishedAt);
  const parts = running
    ? [lastSentence(last, words)]
    : [lastSentence(last, words) ?? words.never, nextSentence(next, words)];
  return <p className="text-small text-fg-muted">{parts.filter(Boolean).join(" ")}</p>;
}
