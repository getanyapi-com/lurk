import { describe, expect, it } from "vitest";
import { activityFrom, activitySentence, isBusy } from "@/lib/projectActivity";
import type { JobRow } from "@/jobs/enqueue";

/**
 * What "something is happening" means, which is the one thing every screen a
 * new project opens on has to agree about. A job the tick will pick up within
 * the minute is happening; a scan booked for tonight is not.
 */

const NOW = new Date("2026-09-13T12:00:00Z");

function job(row: Partial<JobRow> & { kind: string; runAt: Date }): JobRow {
  return {
    id: `${row.kind}-${row.runAt.toISOString()}`,
    projectId: "project-1",
    startedAt: null,
    finishedAt: null,
    progress: null,
    error: null,
    ...row,
  } as JobRow;
}

describe("what a project is doing", () => {
  it("counts a queued job whose time has passed as active", () => {
    const activity = activityFrom(
      [job({ kind: "discovery_initial", runAt: new Date(NOW.getTime() - 1000) })],
      NOW,
    );

    expect(isBusy(activity)).toBe(true);
    expect(activity.active).toEqual([
      { kind: "discovery_initial", running: false, progress: null },
    ]);
    expect(activitySentence(activity)).toBe(
      "Setting your project up: this starts within a minute.",
    );
  });

  it("counts a running job as active and says what it is doing", () => {
    const activity = activityFrom(
      [
        job({
          kind: "backfill",
          runAt: new Date(NOW.getTime() - 60_000),
          startedAt: new Date(NOW.getTime() - 30_000),
          progress: "Judging 40 of 120 posts",
        }),
      ],
      NOW,
    );

    expect(isBusy(activity)).toBe(true);
    expect(activitySentence(activity)).toBe("Reading the past year: Judging 40 of 120 posts.");
  });

  it("does not count a scan scheduled for later, and says when it runs", () => {
    const later = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    const activity = activityFrom(
      [
        job({
          kind: "scan",
          runAt: new Date(NOW.getTime() - 60_000),
          startedAt: new Date(NOW.getTime() - 60_000),
          finishedAt: new Date(NOW.getTime() - 30_000),
        }),
        job({ kind: "scan", runAt: later }),
      ],
      NOW,
    );

    expect(isBusy(activity)).toBe(false);
    expect(activity.active).toEqual([]);
    expect(activity.nextScan?.runAt).toEqual(later);
    expect(activitySentence(activity)).toContain("Next scan");
  });

  it("never says no scan is scheduled while the first jobs are queued", () => {
    const activity = activityFrom(
      [
        job({ kind: "discovery_initial", runAt: NOW }),
        job({ kind: "backfill", runAt: NOW }),
      ],
      NOW,
    );

    expect(activitySentence(activity)).not.toContain("No scan");
    expect(activity.active.map((one) => one.kind)).toEqual(["discovery_initial", "backfill"]);
  });

  it("reports the failure of the last job that ended", () => {
    const activity = activityFrom(
      [
        job({
          kind: "discovery_initial",
          runAt: new Date(NOW.getTime() - 7200_000),
          startedAt: new Date(NOW.getTime() - 7200_000),
          finishedAt: new Date(NOW.getTime() - 7000_000),
          error: "Google returned 502",
        }),
        job({ kind: "discovery_initial", runAt: new Date(NOW.getTime() + 3600_000) }),
      ],
      NOW,
    );

    expect(isBusy(activity)).toBe(false);
    expect(activitySentence(activity)).toBe(
      "Setting your project up stopped: Google returned 502.",
    );
  });

  it("never shows a person the SQL a failed statement leads with", () => {
    const activity = activityFrom(
      [
        job({
          kind: "discovery_initial",
          runAt: new Date(NOW.getTime() - 7200_000),
          startedAt: new Date(NOW.getTime() - 7200_000),
          finishedAt: new Date(NOW.getTime() - 7000_000),
          error: 'Failed query: select "id" from "search_runs" where "kind" = $1; code 23505',
        }),
      ],
      NOW,
    );

    expect(activitySentence(activity)).toBe(
      "Setting your project up stopped: the database could not finish it. It is safe to try again.",
    );
  });
});
