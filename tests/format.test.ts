import { describe, expect, it } from "vitest";
import { compactCount, fullCount } from "@/lib/format";

/**
 * The detail panes, the SEO tab and Insights write a count out in full, and
 * X's thread writes the short one X prints under a post.
 */
describe("counts", () => {
  it("writes a count in full, and a dash for one the platform never gave", () => {
    expect(fullCount(12345)).toBe("12,345");
    expect(fullCount(0)).toBe("0");
    expect(fullCount(null)).toBe("-");
    expect(fullCount(undefined, "No app limit")).toBe("No app limit");
  });

  it("shortens a count, with X's capital K when asked", () => {
    expect(compactCount(950)).toBe("950");
    expect(compactCount(1200)).toBe("1.2k");
    expect(compactCount(18_000)).toBe("18k");
    expect(compactCount(1200, { upper: true })).toBe("1.2K");
    expect(compactCount(2_400_000, { upper: true })).toBe("2.4M");
  });
});
