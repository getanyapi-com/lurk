import { describe, expect, it } from "vitest";
import { ScoutBudget } from "../scripts/x-scout-budget";

describe("scout spending guard", () => {
  it("counts concurrent reservations before authorizing another purchase", () => {
    const b = new ScoutBudget(.1);
    const finish = b.reserve(.06);
    expect(() => b.reserve(.05)).toThrow("before request");
    finish(.01);
    expect(b.spent).toBe(.01);
    expect(b.reserved).toBe(0);
    b.reserve(.09);
  });
  it("charges the full reservation for unknown or failed billing", () => {
    for (const unknown of [undefined, null, NaN, -1, "0", Infinity]) {
      const b = new ScoutBudget(.1);
      b.reserve(.1)(unknown);
      expect(b.spent).toBe(.1);
      expect(() => b.reserve(.001)).toThrow();
    }
  });
  it("retains an overcharged amount and forbids duplicate settlement", () => {
    const b = new ScoutBudget(.1), finish = b.reserve(.02);
    expect(() => finish(.03)).toThrow("exceeded");
    expect(b.spent).toBe(.03);
    expect(() => b.reserve(.001)).toThrow("disabled");
    expect(() => finish(0)).toThrow("already settled");
    expect(() => b.reserve(-1)).toThrow();
  });
});
