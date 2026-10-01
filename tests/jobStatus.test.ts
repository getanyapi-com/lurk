import { describe, expect, it } from "vitest";
import { JobStatus, type JobWords } from "@/components/JobStatus";
import type { JobRow } from "@/jobs/enqueue";
import { errorSentence } from "@/lib/format";

/**
 * The status line a tab draws under its title. A job's stored error is written
 * for whoever debugs it, and a failed statement leads with its SQL, so every
 * tab says that one in words: the person reading it can do nothing with SQL.
 */

const HOUR_MS = 3_600_000;

const SQL_ERROR =
  'Failed query: select "id" from "reddit_posts" where "id" = $1\nparams: abc';

const WORDS: JobWords = {
  noun: "scan",
  running: "Scanning now",
  finished: (_job, ago) => `Last scanned ${ago}.`,
  stopped: "Last scan stopped",
  never: "No competitor scan has run yet.",
  button: "Scan now",
};

function job(overrides: Partial<JobRow>): JobRow {
  return {
    id: "job-1",
    kind: "competitor_scan",
    projectId: "project-1",
    runAt: new Date(),
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: null,
    ...overrides,
  } as JobRow;
}

/** The line a JobStatus draws, read off the element without rendering it. */
function line(last: JobRow | null, next: JobRow | null): string {
  return (JobStatus({ last, next, words: WORDS }).props as { children: string }).children;
}

describe("a stored failure as a person reads it", () => {
  it("says a failed statement in words instead of its SQL", () => {
    expect(errorSentence(SQL_ERROR)).toBe("the database could not finish it. It is safe to try again.");
  });

  it("keeps the first line of anything else, ending it with one full stop", () => {
    expect(errorSentence("Google returned 502\n    at fetch (x.ts:1)")).toBe("Google returned 502.");
    expect(errorSentence("  The wallet is empty.  ")).toBe("The wallet is empty.");
  });
});

describe("the job status line", () => {
  const finished = new Date(Date.now() - 2 * HOUR_MS);
  const next = job({ runAt: new Date(Date.now() + 3 * HOUR_MS) });

  it("never shows the SQL a failed job stored", () => {
    const failed = job({ startedAt: finished, finishedAt: finished, error: SQL_ERROR });
    expect(line(failed, next)).toBe(
      "Last scan stopped: the database could not finish it. It is safe to try again. Next scan in 3h.",
    );
  });

  it("says what ran and what is next, or only the progress while one runs", () => {
    expect(line(job({ startedAt: finished, finishedAt: finished }), next)).toBe(
      "Last scanned 2h ago. Next scan in 3h.",
    );
    expect(line(job({ startedAt: finished, progress: "4 of 9 competitors" }), null)).toBe(
      "Scanning now: 4 of 9 competitors",
    );
    expect(line(null, null)).toBe("No competitor scan has run yet. No scan is scheduled. Press Scan now.");
  });
});
