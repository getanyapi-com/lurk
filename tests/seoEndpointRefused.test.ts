import { describe, expect, it } from "vitest";
import { SeoEndpointRefusedError, refuseSeoEndpoint } from "@/lib/anyapi";

/** lurk never buys AnyAPI's seo endpoints, and the refusal sits where every request passes. */
describe("the gateway seam", () => {
  it("refuses any seo endpoint before it is sent", () => {
    for (const slug of ["seo.search_volume", "seo.keyword", "SEO.domain", "seo%2Ekeyword"]) {
      expect(() => refuseSeoEndpoint(`https://api.getanyapi.com/v1/run/${slug}`)).toThrow(
        SeoEndpointRefusedError,
      );
    }
  });

  it("lets through what lurk does buy", () => {
    for (const path of ["/v1/run/reddit.search", "/v1/run/google.search", "/v1/run/web.scrape", "/v1/balance"]) {
      expect(() => refuseSeoEndpoint(`https://api.getanyapi.com${path}`)).not.toThrow();
    }
  });
});
