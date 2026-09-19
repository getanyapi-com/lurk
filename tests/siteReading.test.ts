import { describe, expect, it } from "vitest";
import { groundedLimits, sitePageLinks } from "@/lib/profile";

/**
 * A limit on who can buy is the one profile fact that loses leads silently when
 * it is wrong, so it stands only on words the site really says.
 */
describe("the limits a profile keeps", () => {
  const site = "# Radish\n\n**Download on the App Store**. Requires iOS 18 or later. [Pricing](/pricing)";

  it("keeps a limit whose source is on the site, markdown and case aside", () => {
    expect(
      groundedLimits([{ text: "iPhone only", sourceText: "download on the app store" }], site),
    ).toEqual(["iPhone only"]);
  });

  it("drops a limit the site never says, and one with no source at all", () => {
    expect(
      groundedLimits(
        [
          { text: "does not host applications", sourceText: "WordPress hosting only" },
          { text: "no Android", sourceText: "" },
        ],
        site,
      ),
    ).toEqual([]);
  });
});

describe("the pages read beside the homepage", () => {
  const markdown = [
    "[Blog](/blog) [About us](/about) [Pricing](https://acme.com/pricing/) [FAQ](/faq)",
    "[Features](/features) [Their pricing](https://rival.com/pricing) [Deep](/docs/api/pricing/v2)",
  ].join("\n");

  it("takes same-site pricing, features and FAQ pages, pricing first, three at most", () => {
    expect(sitePageLinks("https://acme.com/", markdown)).toEqual([
      "https://acme.com/pricing",
      "https://acme.com/features",
      "https://acme.com/faq",
    ]);
  });

  it("finds nothing on a page with no address to resolve links against", () => {
    expect(sitePageLinks("not a url", markdown)).toEqual([]);
  });
});
