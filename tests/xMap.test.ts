import { describe, expect, it } from "vitest";
import { canonicalUrl, cursorOfSearch, decodeXEntities, lookupUrl, ownText, ownWords, postsOfSearch, toXAuthor, toXPost } from "@/lib/x/map";

/**
 * twitter.search and twitter.tweet spell the same facts differently (probe
 * 2026-09-27), and X ids are snowflakes above 2^53. Shapes copied from the
 * probe's raw responses.
 */
describe("mapping twitter.* payloads", () => {
  const searchItem = {
    authorFollowers: 43,
    authorId: "1959497956371095552",
    authorImage: "https://pbs.twimg.com/profile_images/x.jpg",
    authorName: "abhiram",
    authorUsername: "abhiitxt",
    authorVerified: true,
    bookmarkCount: 0,
    conversationId: "2103981411753398408",
    createdUtc: 1790463233,
    id: "2103981411753398408",
    inReplyToId: null,
    isReply: false,
    lang: "en",
    likeCount: 1,
    media: [],
    quoteCount: 0,
    replyCount: 0,
    retweetCount: 0,
    text: "Is there any alternative to calendly???",
    url: "https://x.com/i/web/status/2103981411753398408",
    viewCount: 55,
  };
  const tweetData = {
    authorHandle: "jackedAJ",
    authorId: "1492155169198391301",
    authorName: "Ajeet",
    authorVerified: true,
    bookmarks: 6,
    conversationId: "1810892664826376275",
    createdUtc: 1720585436,
    id: "1810892687341465807",
    inReplyToId: "1810892682429968482",
    lang: "en",
    likes: 6,
    media: [],
    quotes: 0,
    replies: 1,
    retweets: 0,
    text: "5. Open Source Alternative to Notion",
    views: 1776,
  };

  it("reads a search item and a tweet payload into one shape", () => {
    const fromSearch = toXPost(searchItem)!;
    const fromTweet = toXPost(tweetData)!;
    expect(fromSearch.authorUsername).toBe("abhiitxt");
    expect(fromSearch.likeCount).toBe(1);
    expect(fromSearch.authorFollowers).toBe(43);
    expect(fromTweet.authorUsername).toBe("jackedAJ");
    expect(fromTweet.likeCount).toBe(6);
    expect(fromTweet.viewCount).toBe(1776);
    expect(fromTweet.isReply).toBe(true);
    expect(fromTweet.createdAt.toISOString()).toBe("2024-07-10T04:23:56.000Z");
  });

  it("keeps a snowflake id as the string it arrived as", () => {
    const post = toXPost({ ...searchItem, id: "2094307491903668393" })!;
    expect(post.id).toBe("2094307491903668393");
    expect(typeof post.id).toBe("string");
    expect(toXPost({ ...searchItem, id: 2094307491903668393 })).toBeNull();
  });

  it("drops an item missing what a post cannot be stored without", () => {
    expect(toXPost({ ...searchItem, text: undefined })).toBeNull();
    expect(toXPost({ ...searchItem, createdUtc: undefined })).toBeNull();
    expect(postsOfSearch({ items: [searchItem, { id: "1" }] })).toHaveLength(1);
    expect(postsOfSearch(null)).toEqual([]);
    expect(cursorOfSearch({ nextCursor: "abc" })).toBe("abc");
    expect(cursorOfSearch({ nextCursor: "" })).toBeNull();
  });

  it("reads a profile, lowercasing the handle", () => {
    const author = toXAuthor(
      { handle: "jackedAJ", bio: "ex ai eng", followers: 17354, following: 3712, createdUtc: 1644592550, private: false, verified: true },
      "jackedaj",
    )!;
    expect(author.username).toBe("jackedaj");
    expect(author.bio).toBe("ex ai eng");
    expect(author.accountCreatedAt?.getUTCFullYear()).toBe(2022);
  });

  it("strips the leading @handles a reply carries, and nothing else", () => {
    expect(ownText("@a @b_c  is x api expensive or not?")).toBe("is x api expensive or not?");
    expect(ownText("ask @someone about it")).toBe("ask @someone about it");
  });

  it("decodes the HTML entities X escapes text with, once", () => {
    expect(decodeXEntities("Slack &gt; Photoshop, pros &amp; cons, &lt;3")).toBe("Slack > Photoshop, pros & cons, <3");
    expect(decodeXEntities("&amp;gt; stays literal")).toBe("&gt; stays literal");
    expect(toXPost({ ...searchItem, text: "free &amp; unlimited" })!.text).toBe("free & unlimited");
  });

  it("strips the handles a reply opens with, but keeps a top-level post's opening name", () => {
    expect(ownWords({ text: "@a is it expensive?", isReply: true })).toBe("is it expensive?");
    expect(ownWords({ text: "@Hotjar alternatives that don't cost $200/mo?", isReply: false })).toBe(
      "@Hotjar alternatives that don't cost $200/mo?",
    );
  });

  it("builds the links a card opens and a lookup asks for", () => {
    expect(canonicalUrl("abhiitxt", "2103981411753398408")).toBe("https://x.com/abhiitxt/status/2103981411753398408");
    expect(lookupUrl("2103981411753398408")).toBe("https://x.com/i/status/2103981411753398408");
  });
});
