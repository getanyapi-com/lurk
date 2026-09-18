import { AnyAPIError } from "@getanyapi/sdk";
import { config } from "@/lib/config";

/**
 * One pace for every paid Reddit call this process makes, whatever job makes
 * it. The gateway paces nothing: it has no per-key limit, no queue, and a
 * vendor's 429 on the one key it holds is passed straight back to us. Each
 * vendor behind `reddit.*` does have a limit (measured 2026-09-17: the dearest
 * lane allows 300 a minute, the cheapest 15 a second), and every backfill,
 * scan and thread read in this process shares them. So the pace is shared too,
 * and it is one number the process learns rather than one each job guesses.
 *
 * It is bursty on purpose. A job starts at the full allowance, because a sweep
 * that finishes in ten seconds is the product. It slows the moment a vendor
 * says stop: a rate-limited or all-providers-failed answer halves how many
 * calls may be in flight and holds them there for a while, then the allowance
 * grows back one call at a time as calls succeed. That is additive increase,
 * multiplicative decrease, the loop TCP uses for the same problem.
 *
 * Two knobs, both in the environment so a vendor plan change is a config
 * change: how many calls may be in flight at once, and how many may start in
 * one second. The measured run peaked at 9 a second on 10 in flight without a
 * refusal; 40 and 12 leave the cheapest lane's budget for a second job.
 */

const GROW_AFTER = 20;
const HOLD_MS = 10_000;
const RETRY_WAITS_MS = [1_000, 3_000];

export type PaceSnapshot = {
  /** Calls the pace allows in flight right now. */
  limit: number;
  /** Calls in flight right now. */
  inFlight: number;
  /** Refusals the pace has absorbed since the process started. */
  refusals: number;
  /** Calls the pace has let through since the process started. */
  calls: number;
};

type Settings = { inFlight: number; perSecond: number };

type Waiter = () => void;

type State = {
  settings: Settings;
  limit: number;
  inFlight: number;
  tokens: number;
  refilledAt: number;
  successes: number;
  holdUntil: number;
  refusals: number;
  calls: number;
  waiters: Waiter[];
};

function settingsFromEnv(): Settings {
  const { REDDIT_CALLS_IN_FLIGHT, REDDIT_CALLS_PER_SECOND } = config();
  return { inFlight: REDDIT_CALLS_IN_FLIGHT, perSecond: REDDIT_CALLS_PER_SECOND };
}

function fresh(settings: Settings = settingsFromEnv()): State {
  return {
    settings,
    limit: settings.inFlight,
    inFlight: 0,
    tokens: settings.perSecond,
    refilledAt: Date.now(),
    successes: 0,
    holdUntil: 0,
    refusals: 0,
    calls: 0,
    waiters: [],
  };
}

let held: State | null = null;

/** The state, made on first use so importing this file reads no config. */
function state(): State {
  held ??= fresh();
  return held;
}

/** The pace as it stands, for a progress line or a test. */
export function paceSnapshot(): PaceSnapshot {
  return {
    limit: state().limit,
    inFlight: state().inFlight,
    refusals: state().refusals,
    calls: state().calls,
  };
}

/** Forgets everything learned. For tests, and for a process that changes plan. */
export function resetPace(settings?: Partial<Settings>): void {
  held = fresh({ ...settingsFromEnv(), ...settings });
}

/** The floor the allowance can fall to: enough to keep a walk moving. */
function floor(): number {
  return Math.min(4, state().settings.inFlight);
}

function refill(now: number): void {
  const elapsed = (now - state().refilledAt) / 1000;
  if (elapsed <= 0) {
    return;
  }
  state().tokens = Math.min(state().settings.perSecond, state().tokens + elapsed * state().settings.perSecond);
  state().refilledAt = now;
}

/** Whether a call may start now, taking its slot and token if so. */
function tryStart(): boolean {
  const now = Date.now();
  refill(now);
  if (state().inFlight >= state().limit || state().tokens < 1) {
    return false;
  }
  state().inFlight += 1;
  state().tokens -= 1;
  state().calls += 1;
  return true;
}

/** How long until a token exists, when slots are free but tokens are not. */
function untilToken(): number {
  const missing = Math.max(0, 1 - state().tokens);
  return Math.ceil((missing / state().settings.perSecond) * 1000);
}

function wake(): void {
  const waiters = state().waiters;
  state().waiters = [];
  for (const waiter of waiters) {
    waiter();
  }
}

async function acquire(): Promise<void> {
  for (;;) {
    if (tryStart()) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, state().inFlight >= state().limit ? 250 : untilToken());
      state().waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function release(): void {
  state().inFlight = Math.max(0, state().inFlight - 1);
  wake();
}

function succeeded(): void {
  state().successes += 1;
  if (state().successes >= GROW_AFTER && Date.now() >= state().holdUntil) {
    state().successes = 0;
    state().limit = Math.min(state().settings.inFlight, state().limit + 1);
  }
}

/**
 * A refusal is a vendor saying stop, or the gateway having no vendor left to
 * ask. Both mean the lanes are saturated, whichever job saturated them.
 */
export function isRefusal(error: unknown): boolean {
  if (!(error instanceof AnyAPIError)) {
    return false;
  }
  return (
    error.status === 429 ||
    error.status === 503 ||
    error.code === "provider_rate_limited" ||
    error.code === "all_providers_failed"
  );
}

function refused(): void {
  state().refusals += 1;
  state().successes = 0;
  state().limit = Math.max(floor(), Math.floor(state().limit / 2));
  state().holdUntil = Date.now() + HOLD_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one paid Reddit call inside the shared pace. A refusal slows the pace
 * and is retried a couple of times after a short wait, because the gateway
 * charges nothing for it and says to retry shortly; a refusal that outlasts
 * the retries is thrown to the caller as it came. Any other error is thrown
 * as it came and does not change the pace.
 */
export async function paced<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await acquire();
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      release();
      if (!isRefusal(error)) {
        throw error;
      }
      refused();
      const wait = RETRY_WAITS_MS[attempt];
      if (wait === undefined) {
        throw error;
      }
      await sleep(wait + Math.random() * 500);
      continue;
    }
    release();
    succeeded();
    return result;
  }
}
