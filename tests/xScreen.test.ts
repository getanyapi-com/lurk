import { describe, expect, it } from "vitest";
import type { XPost } from "@/lib/x/map";
import { DIY_WORDS, HARNESS_WORDS, RIVAL_WORDS } from "@/lib/x/lanes";
import { containsAtWordStart, fold, freeScreen, isListicle, isVendorHook, isVendorLaunch, matchedLaneTerms, sentencesOf } from "@/lib/x/screen";

/**
 * The free screen, held to real posts the 2026-09-27 probe pulled from X (the
 * texts, not the handles). It must keep the asks and drop the noise that
 * matched the same phrases: vendor hooks, listicles, freelancer spam, traders.
 */

const NOW = new Date("2026-09-27T12:00:00Z");

function post(text: string, extra: Partial<XPost> = {}): XPost {
  return {
    id: "2103981411753398408",
    text,
    lang: "en",
    createdAt: new Date(NOW.getTime() - 3_600_000),
    authorUsername: "someone",
    authorName: "Someone",
    authorId: null,
    authorImage: null,
    authorFollowers: 300,
    authorVerified: false,
    isReply: false,
    inReplyToId: null,
    conversationId: "2103981411753398408",
    likeCount: 0,
    replyCount: 0,
    retweetCount: 0,
    quoteCount: 0,
    viewCount: 40,
    bookmarkCount: 0,
    mediaCount: 0,
    ...extra,
  };
}

const base = {
  since: new Date(NOW.getTime() - 7 * 24 * 3_600_000),
  lang: "en",
  ownNames: ["Cal.com", "cal"],
  rivals: ["calendly", "typeform", "loom", "jotform"],
};

/** A rival lane's terms for these rivals, as lanes.ts compiles them. */
function screen(text: string, rivals: string[], extra: Partial<XPost> = {}) {
  return freeScreen({ ...base, laneTerms: [rivals, RIVAL_WORDS], post: post(text, extra) });
}

describe("the X free screen", () => {
  it.each([
    ["I'm looking for an alternative to Calendly, and the only feature I want is round-robin scheduling.", ["calendly"]],
    ["Is there any alternative to calendly???  coz calendly is crazy and I can never have peace with how it works", ["calendly"]],
    ["Anyone using a solid open source alternative to Loom? Looking for something I can self host.", ["loom"]],
    ["Looking for a Typeform alternative? Any ideas?", ["typeform"]],
  ])("keeps a real ask: %s", (text, seeds) => {
    expect(screen(text, seeds)).toEqual({ pass: true });
  });

  it.each([
    [
      "Looking for a Jotform alternative? Youform gives you unlimited forms and responses for free — while Jotform's free plan is limited to 5 forms.",
      ["jotform"],
      "vendor_hook",
    ],
    ["Want a low-cost alternative to Calendly? https://t.co/df1loFuwH7", ["calendly"], "vendor_hook"],
    [
      "PAID VERSION → FREE ALTERNATIVE\n\n1. ChatGPT Plus → Google Gemini\n2. Netflix Premium → Tubi\n3. Typeform → Tally",
      ["typeform"],
      "listicle",
    ],
    ['10 GitHub repos that seem "illegal" but are perfectly legal 1. yt-dlp', ["typeform"], "listicle"],
    ["Hi! Saw you're looking for a motion designer. I'm Shivam, experienced graphic designer.", ["typeform"], "job_or_gig"],
    ["$SPX 7765C 1.70 looking for the original lotto plan to play out now $QQQ", ["vanta"], "trading_or_crypto"],
    ["@grok which is the best alternative to calendly?", ["calendly"], "machine_query"],
    ["https://t.co/CqtaN4mzzL", ["calendly"], "bare_link"],
    ["Big companies sell you their paid alternatives, but here are 20 tools that are free & better", ["typeform"], "listicle"],
  ])("drops noise: %s", (text, seeds, reason) => {
    expect(screen(text, seeds)).toEqual({ pass: false, reason });
  });

  it.each([
    ["I need an alternative to Calendly that has:\n- round robin\n- Stripe payments\n- embeds\nAny ideas?", ["calendly"]],
    ["@Calendly alternatives that don't cost $20 a seat? Asking for my agency", ["calendly"]],
    ["Tried 3 alternatives to Calendly already, none do round robin properly. What else is there?", ["calendly"]],
    ["AirDrop keeps failing on my Mac, need an alternative to Calendly links I can share instead?", ["calendly"]],
  ])("keeps a genuine ask that only looks like noise: %s", (text, seeds) => {
    expect(screen(text, seeds)).toEqual({ pass: true });
  });

  it("drops a post from the project's own account or a rival's", () => {
    expect(screen("We just shipped round robin for teams, the best alternative to Calendly", ["calendly"], { authorUsername: "calcom" })).toEqual({ pass: false, reason: "own_or_rival_account" });
    expect(screen("Tired of double bookings? Try the alternative to Calendly we built", ["calendly"], { authorUsername: "Calendly" })).toEqual({ pass: false, reason: "own_or_rival_account" });
  });

  it("drops a top-level post that does not show every group of its lane in one sentence of its own words", () => {
    expect(screen("This is the tool I was looking for, finally something that works", ["calendly"])).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
    expect(screen("Calendly just shipped a lovely new dark mode for everyone", ["calendly"])).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
    // The brand and the switch word sentences apart is a long post about something else.
    expect(screen("Calendly is what our whole team uses every day. Separately, is there a good alternative to paper notebooks?", ["calendly"])).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
    // A pain lane's first group is a phrase: "x api" must show as the phrase, never as the letter x.
    const pain = [["x api", "twitter api"], ["expensive", "pricing"]];
    expect(freeScreen({ ...base, laneTerms: pain, post: post("The X API is so expensive I deleted my side project") })).toEqual({ pass: true });
    expect(freeScreen({ ...base, laneTerms: pain, post: post("x marks the spot, and the api pricing page is lovely") })).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
    // "$0.48" is not a sentence break, and "X-API" folds to "x api".
    expect(freeScreen({ ...base, laneTerms: pain, post: post("So a 6 post thread costs $0.48 on the X-API. Pricing is wild") })).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
    expect(freeScreen({ ...base, laneTerms: pain, post: post("The X-API pricing: a 6 post thread costs $0.48. Wtf") })).toEqual({ pass: true });
    // A reply may show its lane's words anywhere in what X returned, its @handles included.
    expect(
      screen("@calendly is there any alternative that does round robin for free?", ["calendly"], { isReply: true, inReplyToId: "1" }),
    ).toEqual({ pass: true });
    expect(screen("@someone this is exactly what I needed for the whole team", ["calendly"], { isReply: true, inReplyToId: "1" })).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
  });

  it("drops every post of an author with three or more on one page, and a launch in the buyer's own words", () => {
    expect(freeScreen({ ...base, laneTerms: [], authorPostsOnPage: 3, post: post("alternative to calendly, anyone?") })).toEqual({
      pass: false,
      reason: "reply_farm",
    });
    expect(isVendorLaunch("A broken contact form can quietly cost you leads. I built Formwatch to catch it before your clients do.")).toBe(true);
    expect(isVendorLaunch("I'm building Acme and need a better scheduling tool, any ideas?")).toBe(false);
    expect(isVendorLaunch("I built a tool with my team last year and we still use it")).toBe(false);
    // A builder naming what they built on, or complaining, is not a launch.
    expect(isVendorLaunch("I built on Firecrawl and the pricing is brutal at our volume")).toBe(false);
    expect(isVendorLaunch("We built our MVP on Apify. Now it breaks every week.")).toBe(false);
    expect(isVendorLaunch("Introducing Social SDK: posting, comments and analytics in one call")).toBe(true);
  });

  it("keeps a buyer's list of requirements, and ends no sentence at an abbreviation", () => {
    expect(isListicle("Looking for a CRM that has:\n1. email sync\n2. pipelines\n3. a free tier")).toBe(false);
    expect(isListicle("Top tools this week\n1. one\n2. two\n3. three")).toBe(true);
    expect(sentencesOf("Tried e.g. Calendly vs. SavvyCal and hated both. Any alternative?")).toEqual([
      "Tried e.g. Calendly vs. SavvyCal and hated both.",
      "Any alternative?",
    ]);
  });

  it("splits sentences at a stop and a space or a line break, never inside a number or a URL", () => {
    expect(sentencesOf("Costs $0.48 per thread. See https://t.co/abc.d now\nwild")).toEqual(["Costs $0.48 per thread.", "See https://t.co/abc.d now", "wild"]);
    expect(fold("Too-expensive X-API, “really”")).toBe("too expensive x api really");
  });

  it("drops what is stale or in another language, and lets posts with no language through", () => {
    expect(screen("alternative to calendly anyone?", ["calendly"], { createdAt: new Date(base.since.getTime() - 1) })).toEqual({ pass: false, reason: "stale" });
    expect(screen("alternativa a calendly alguien?", ["calendly"], { lang: "es" })).toEqual({ pass: false, reason: "other_language" });
    expect(screen("alternative to calendly anyone? 👀", ["calendly"], { lang: "qme" })).toEqual({ pass: true });
  });

  it("matches a phrase only at a word start, so 'your api' is never 'our api'", () => {
    expect(containsAtWordStart("is your api down", "our api")).toBe(false);
    expect(containsAtWordStart("check out our api", "our api")).toBe(true);
    expect(containsAtWordStart("giveaways all week", "giveaway")).toBe(true);
  });

  it("tells a hook from an ask by voice and by where it points", () => {
    expect(isVendorHook("Looking for a Typeform alternative? Youform gives you unlimited forms")).toBe(true);
    expect(isVendorHook("Looking for a Typeform alternative? I need one for my clients")).toBe(false);
    expect(isListicle("my three favourite tools are great")).toBe(false);
  });

  it("names the lane's words the post shows, one per group", () => {
    expect(matchedLaneTerms(post("Is there any Alternative to Calendly???"), [["calendly"], RIVAL_WORDS])).toBe("calendly · alternative");
    expect(matchedLaneTerms(post("Calendly is great"), [["calendly"], RIVAL_WORDS])).toBeNull();
  });
});

describe("the X free screen for venue lanes", () => {
  const workflow = [HARNESS_WORDS, ["scrape", "scraping", "scraper"]];

  it("keeps a numbered workflow, with its words steps apart, that a rival lane would drop as a listicle", () => {
    const text =
      "setup i use for influencer outreach:\n1) apify - scrape tiktok by niche hashtags\n2) claude drafts every email\n3) gmail + app password\n4) n8n glues it together";
    expect(isListicle(text)).toBe(true);
    expect(freeScreen({ ...base, laneTerms: workflow, post: post(text), venue: true })).toEqual({ pass: true });
    expect(matchedLaneTerms(post(text), workflow, true)).toBe("n8n · scrape");
  });

  it("still drops a listicle headline and a post that never shows the lane's words", () => {
    expect(
      freeScreen({ ...base, laneTerms: workflow, post: post("10 tools for scraping with n8n in 2026:\n1. a\n2. b\n3. c"), venue: true }),
    ).toEqual({ pass: false, reason: "listicle" });
    expect(freeScreen({ ...base, laneTerms: workflow, post: post("n8n is great for my newsletter"), venue: true })).toEqual({
      pass: false,
      reason: "no_visible_term",
    });
  });

  it("keeps a build-your-own post naming the rival", () => {
    const text = "So we vibe coded our own Calendly++. Why the heck would you do this, when Calendly is cheap and just works?";
    expect(freeScreen({ ...base, rivals: [], laneTerms: [["calendly"], DIY_WORDS], post: post(text), venue: true })).toEqual({ pass: true });
  });
});
