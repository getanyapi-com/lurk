import { describe, expect, it } from "vitest";
import { pagesPerDayAt, projectedWalletCostPerDay } from "@/lib/x/read";

/**
 * The upgrade line quotes what an hourly wallet would pay for this project's
 * X, from its own lanes' post rates. The backoff model and the rounding are
 * the claim, so they are pinned.
 */
describe("the projected wallet cost", () => {
  it("polls a busy lane every hour and backs a quiet one off", () => {
    expect(pagesPerDayAt(2)).toBe(24);
    expect(pagesPerDayAt(1)).toBe(24);
    expect(pagesPerDayAt(0)).toBe(3);
    // One post a day: three hourly polls, then 2, 4, 8, 8 hours = 7 pages a day.
    expect(pagesPerDayAt(1 / 24)).toBe(7);
    expect(pagesPerDayAt(1 / 12)).toBeGreaterThan(pagesPerDayAt(1 / 24));
  });

  it("rounds up to the cent and never quotes nothing", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const created = new Date(now.getTime() - 24 * 3_600_000);
    expect(projectedWalletCostPerDay([], now)).toBe(0.01);
    // 2 posts over the first look's month + 1 day: a quiet lane, 3 pages a day and lookups, a cent.
    expect(projectedWalletCostPerDay([{ newPosts: 2, createdAt: created, state: "active", fullPages: 0 }], now)).toBe(0.01);
    const busy = projectedWalletCostPerDay([{ newPosts: 400, createdAt: created, state: "active", fullPages: 0 }], now);
    expect(busy).toBeGreaterThan(0.01);
    expect(projectedWalletCostPerDay([{ newPosts: 400, createdAt: created, state: "paused", fullPages: 0 }], now)).toBe(0.01);
  });

  it("counts a lane whose pages stopped short of its month as a day read, so a busy lane is not quoted low", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const lane = { newPosts: 60, createdAt: now, state: "active" };
    expect(projectedWalletCostPerDay([{ ...lane, fullPages: 1 }], now)).toBeGreaterThan(projectedWalletCostPerDay([{ ...lane, fullPages: 0 }], now));
  });
});
