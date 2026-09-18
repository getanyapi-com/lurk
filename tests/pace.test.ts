import { AnyAPIError, RateLimitedError } from "@getanyapi/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { isRefusal, paceSnapshot, paced, resetPace } from "@/lib/reddit/pace";

/**
 * The shared pace every paid Reddit call runs inside. What it must do: let a
 * burst start at the full allowance, refuse to start more than that, halve
 * the allowance when a vendor says stop and retry the call, grow it back as
 * calls succeed, and leave any other error exactly as it was thrown.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

process.env.DATABASE_URL ??= "postgres://unused";
process.env.APP_ENCRYPTION_KEY ??= "unused";

describe("paced", () => {
  beforeEach(() => {
    resetPace({ inFlight: 8, perSecond: 1000 });
  });

  it("starts a burst at the full allowance and no more", async () => {
    let live = 0;
    let peak = 0;
    const calls = Array.from({ length: 20 }, () =>
      paced(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await sleep(10);
        live -= 1;
      }),
    );
    await Promise.all(calls);
    expect(peak).toBe(8);
    expect(paceSnapshot().calls).toBe(20);
    expect(paceSnapshot().inFlight).toBe(0);
  });

  it("starts no more calls in a second than the allowance", async () => {
    resetPace({ inFlight: 100, perSecond: 5 });
    const started: number[] = [];
    const begin = Date.now();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        paced(async () => {
          started.push(Date.now() - begin);
        }),
      ),
    );
    const inFirstHalfSecond = started.filter((at) => at < 500).length;
    expect(inFirstHalfSecond).toBeLessThanOrEqual(8);
    expect(Math.max(...started)).toBeGreaterThanOrEqual(900);
  });

  it("halves the allowance on a refusal, retries the call, and grows back", async () => {
    let attempts = 0;
    const result = await paced(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new RateLimitedError("slow down", 429, "req", "provider_rate_limited");
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(paceSnapshot()).toMatchObject({ limit: 4, refusals: 1, inFlight: 0 });

    // Held for a while after a refusal, then one call wider per twenty successes.
    for (let index = 0; index < 20; index += 1) {
      await paced(async () => undefined);
    }
    expect(paceSnapshot().limit).toBe(4);
  }, 10_000);

  it("gives up on a refusal that outlasts its retries, as it came", async () => {
    const refusal = new AnyAPIError("no lane left", 502, "req", "all_providers_failed");
    await expect(paced(async () => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(paceSnapshot().refusals).toBe(3);
    expect(paceSnapshot().inFlight).toBe(0);
  }, 15_000);

  it("leaves any other error alone and unpaced", async () => {
    const bad = new AnyAPIError("bad input", 400, "req", "filter_unsupported");
    await expect(paced(async () => Promise.reject(bad))).rejects.toBe(bad);
    expect(paceSnapshot()).toMatchObject({ limit: 8, refusals: 0, inFlight: 0 });
  });

  it("names what a refusal is", () => {
    expect(isRefusal(new RateLimitedError("x", 429))).toBe(true);
    expect(isRefusal(new AnyAPIError("x", 503))).toBe(true);
    expect(isRefusal(new AnyAPIError("x", 502, undefined, "all_providers_failed"))).toBe(true);
    expect(isRefusal(new AnyAPIError("x", 502, undefined, "provider_error"))).toBe(false);
    expect(isRefusal(new Error("x"))).toBe(false);
  });
});
