import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/jobs/registry";

const { claim, run } = vi.hoisted(() => ({ claim: vi.fn(), run: vi.fn() }));
vi.mock("@/jobs/runner", () => ({
  WATCHED_KINDS: ["discovery_initial", "backfill"], claimNextJob: claim, runClaimedJob: run,
}));
vi.mock("@/jobs/enqueue", () => ({ enqueueOnce: vi.fn(), lastRunJob: vi.fn() }));
vi.mock("@/lib/config", () => ({ config: () => ({
  SCHEDULER_WORKERS: 1, SCHEDULER_WATCHED_WORKERS: 1, SCHEDULER_SEED: false,
}) }));

/** No tick is fired: a lost wake-up would leave each of these jobs waiting. */
describe("scheduler wake-ups during an in-flight claim", () => {
  beforeEach(() => {
    vi.resetModules();
    claim.mockReset().mockResolvedValue(null);
    run.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, Symbol.for("lurk.scheduler.kick"));
  });

  it("remembers a request's kick without issuing concurrent claims", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    claim.mockImplementationOnce(async () => { await held; return null; });
    const job = { id: "backfill", kind: "backfill" } as Job;
    claim.mockResolvedValueOnce(job);
    const { startScheduler, kickScheduler } = await import("@/jobs/scheduler");
    const cron = startScheduler();
    try {
      kickScheduler();
      await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
      kickScheduler();
      kickScheduler();
      expect(claim).toHaveBeenCalledOnce();
      release();
      await vi.waitFor(() => expect(run).toHaveBeenCalledWith(job));
      await vi.waitFor(() => expect(claim.mock.calls.length).toBeGreaterThanOrEqual(3));
      expect(run).toHaveBeenCalledOnce();
    } finally {
      release();
      cron.stop();
    }
  });

  it("claims the backfill when discovery finishes behind a claim that saw its live lease", async () => {
    let finish = () => {};
    let release = () => {};
    const discovery = new Promise<void>((resolve) => { finish = resolve; });
    const staleClaim = new Promise<void>((resolve) => { release = resolve; });
    const parent = { id: "initial", kind: "discovery_initial", projectId: "project" } as Job;
    const child = { id: "backfill", kind: "backfill", projectId: "project" } as Job;
    run.mockImplementationOnce(() => discovery);
    claim.mockResolvedValueOnce(parent)
      .mockImplementationOnce(async () => { await staleClaim; return null; })
      .mockResolvedValueOnce(child);
    const { startScheduler, kickScheduler } = await import("@/jobs/scheduler");
    const cron = startScheduler();
    try {
      kickScheduler();
      await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
      finish();
      await discovery;
      expect(claim).toHaveBeenCalledTimes(2);
      release();
      await vi.waitFor(() => expect(run).toHaveBeenCalledWith(child));
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      finish();
      release();
      cron.stop();
    }
  });
});
