import { describe, expect, it } from "vitest";

/**
 * twitter.search fails over from a $0.00065 lane to one at up to $0.0154. The
 * price cap makes the gateway refuse that route at no charge, and it must only
 * ever touch the twitter.* calls X leads makes: every other request leaves the
 * wrapper exactly as it came in.
 */
describe("the twitter.* price cap", () => {
  it("caps the three X endpoints and leaves every other call identical", async () => {
    const { withXPriceCap } = await import("@/lib/anyapi");
    const base = "https://api.getanyapi.com/v1/run";
    expect(String(withXPriceCap(`${base}/twitter.search`))).toBe(`${base}/twitter.search?max_cost_usd=0.001`);
    expect(String(withXPriceCap(`${base}/twitter.tweet?fields=id`))).toBe(`${base}/twitter.tweet?fields=id&max_cost_usd=0.0005`);
    expect(String(withXPriceCap(`${base}/twitter.profile`))).toBe(`${base}/twitter.profile?max_cost_usd=0.0005`);
    for (const url of [`${base}/reddit.search`, `${base}/google.search?x=1`, `${base}/web.scrape`, `${base}/twitter.thread`]) {
      expect(withXPriceCap(url)).toBe(url);
    }
  });

  it("rebuilds a Request with the cap and keeps its method and body", async () => {
    const { withXPriceCap } = await import("@/lib/anyapi");
    const request = new Request("https://api.getanyapi.com/v1/run/twitter.search", { method: "POST", body: '{"query":"x"}' });
    const capped = withXPriceCap(request) as Request;
    expect(capped.url).toBe("https://api.getanyapi.com/v1/run/twitter.search?max_cost_usd=0.001");
    expect(capped.method).toBe("POST");
    expect(await capped.text()).toBe('{"query":"x"}');
    const other = new Request("https://api.getanyapi.com/v1/run/reddit.search", { method: "POST" });
    expect(withXPriceCap(other)).toBe(other);
  });
});
