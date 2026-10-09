import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { XOpportunityList } from "@/components/x/XOpportunityList";
import type { XHeldCard, XOpportunity } from "@/lib/x/read";

function opportunity(id: string, priority: number | null): XOpportunity {
  const card: XHeldCard = {
    entryId: `held-${id}`, evaluationId: id, tweetId: id, headline: `Request ${id}`, text: `Request ${id}`, url: `https://x.com/test/status/${id}`,
    authorUsername: `author${id}`, authorName: null, authorImage: null, authorFollowers: null, authorVerified: null, authorLocation: null,
    authorBio: null, authorCreatedAt: null, postedAt: new Date("2026-10-09"), fetchedAt: new Date("2026-10-09"),
    likeCount: null, replyCount: null, viewCount: null, isReply: false, replyingTo: [], foundBy: null, via: null,
    reason: null, reasonCode: null, fit: 3, intent: 3, engagement: 3,
  };
  return { entry: { kind: "held", item: card }, priority, checks: ["Check requirements"] };
}

it("renders uncertain opportunities in one stream, selects them, and keeps weaker/unscored cards accessible", () => {
  const html = renderToStaticMarkup(createElement(XOpportunityList, {
    items: [opportunity("strong", 0.55), opportunity("weak", 0.2), opportunity("unknown", null)],
    params: {}, selectedId: "held-strong",
  }));
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("priority 55");
  expect(html).toContain("Check requirements");
  expect(html.match(/Weaker matches below/gu)).toHaveLength(1);
  expect(html.indexOf("Request strong")).toBeLessThan(html.indexOf("Weaker matches below"));
  expect(html.indexOf("Weaker matches below")).toBeLessThan(html.indexOf("Request weak"));
  expect(html).toContain("Request unknown");
  expect(html).toContain("unscored");
  expect(html).not.toContain(">Maybe<");
  expect(html).not.toContain(">Left out<");
});
