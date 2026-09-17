import { beforeEach, describe, expect, it, vi } from "vitest";
import { competitorHost, domainRoot, matchCompetitorDomain } from "@/lib/competitors/host";
import { TIERS } from "@/lib/tiers";

const generateStructured = vi.fn();

vi.mock("@/lib/llm", () => ({ generateStructured }));
vi.mock("@/db", () => ({ db: () => ({}) }));

const { mentionSeries, topCompetitors } = await import("@/lib/competitors/read");
const { classifyMentions } = await import("@/lib/competitors/classify");
const { competitorsToScan, keepMentions } = await import("@/lib/competitors/scan");
const { competitorsNamed, quoteNaming } = await import("@/lib/competitors/match");
const { threadMentions, competitorsInThread } = await import("@/lib/competitors/threads");

describe("competitor cap", () => {
  const names = ["Typeform", "Jotform", "Tally", "Fillout"];

  it("watches only as many competitors as the free tier allows", () => {
    expect(competitorsToScan(names, TIERS.free)).toEqual(["Typeform", "Jotform", "Tally"]);
    expect(TIERS.free.competitors).toBe(3);
  });

  it("caps nothing for a connected wallet or a self-hosted instance", () => {
    expect(competitorsToScan(names, TIERS.connected)).toEqual(names);
    expect(competitorsToScan(names, null)).toEqual(names);
  });
});

describe("competitor host", () => {
  it("uses a favicon only when the name is a domain", () => {
    expect(competitorHost("typeform.com")).toBe("typeform.com");
    expect(competitorHost("https://www.jotform.com/pricing")).toBe("jotform.com");
    expect(competitorHost("Docs.Google.com")).toBe("docs.google.com");
  });

  it("falls back to initials for a plain product name", () => {
    expect(competitorHost("Typeform")).toBeNull();
    expect(competitorHost("Google Forms")).toBeNull();
    expect(competitorHost("")).toBeNull();
    expect(competitorHost("survey.")).toBeNull();
  });
});

describe("the label a brand owns", () => {
  it("reads past the subdomain and past a two-part suffix", () => {
    expect(domainRoot("typeform.com")).toBe("typeform");
    expect(domainRoot("app.typeform.com")).toBe("typeform");
    expect(domainRoot("typeform.co.uk")).toBe("typeform");
  });
});

describe("pairing a competitor with its site", () => {
  const seen = ["typeform.com", "www.hoteltonight.com", "old.reddit.com"];

  it("takes a name that is already a domain as its own answer", () => {
    expect(matchCompetitorDomain("Jotform.com", ["typeform.com"])).toBe("jotform.com");
  });

  it("finds the site a name spells, punctuation and case aside", () => {
    expect(matchCompetitorDomain("Typeform", seen)).toBe("typeform.com");
    expect(matchCompetitorDomain("Hotel Tonight", seen)).toBe("hoteltonight.com");
  });

  it("gives no site to a name nothing in the evidence matched", () => {
    expect(matchCompetitorDomain("Google Forms", seen)).toBeNull();
    expect(matchCompetitorDomain("Tally", [])).toBeNull();
    expect(matchCompetitorDomain("   ", seen)).toBeNull();
  });
});

describe("sentiment classification", () => {
  beforeEach(() => {
    generateStructured.mockReset();
  });

  it("keeps one verdict per post it sent", async () => {
    generateStructured.mockResolvedValue({
      mentions: [
        {
          id: "p1",
          about: "the_product",
          sentiment: "negative",
          summary: " Leaving after a price rise ",
        },
        { id: "p2", about: "the_product", sentiment: "positive", summary: "Recommends it" },
      ],
    });
    const verdicts = await classifyMentions("project-1", "Typeform", [
      { id: "p1", title: "Done with it", subreddit: "SaaS", body: "the new price" },
      { id: "p2", title: "Works well", subreddit: "SaaS", body: "happy" },
    ]);
    expect(generateStructured.mock.calls[0][0].purpose).toBe("competitors");
    expect(verdicts.get("p1")).toEqual({
      about: "the_product",
      sentiment: "negative",
      summary: "Leaving after a price rise",
    });
    expect(verdicts.get("p2")?.sentiment).toBe("positive");
  });

  it("drops an answer about a post it never sent, and a repeat", async () => {
    generateStructured.mockResolvedValue({
      mentions: [
        { id: "p1", about: "the_product", sentiment: "neutral", summary: "First" },
        { id: "p1", about: "in_passing", sentiment: "positive", summary: "Second" },
        { id: "ghost", about: "the_product", sentiment: "positive", summary: "Never sent" },
      ],
    });
    const verdicts = await classifyMentions("project-1", "Typeform", [
      { id: "p1", title: "Asking", subreddit: "SaaS", body: "which one" },
    ]);
    expect([...verdicts.keys()]).toEqual(["p1"]);
    expect(verdicts.get("p1")?.summary).toBe("First");
  });

  it("asks nothing when there are no posts", async () => {
    expect((await classifyMentions("project-1", "Typeform", [])).size).toBe(0);
    expect(generateStructured).not.toHaveBeenCalled();
  });
});

describe("only posts about the competitor are stored", () => {
  it("keeps a post the writer is using or leaving, and drops a passing link", () => {
    const kept = keepMentions(
      new Map([
        ["p1", { about: "the_product", sentiment: "negative", summary: "Leaving it" } as const],
        [
          "p2",
          {
            about: "in_passing",
            sentiment: "neutral",
            summary: "Shares a Typeform link to RSVP for a French cafe meetup",
          } as const,
        ],
        [
          "p3",
          {
            about: "in_passing",
            sentiment: "neutral",
            summary: "Shared a Google Forms link to vote for favorite songs",
          } as const,
        ],
      ]),
    );
    expect([...kept.keys()]).toEqual(["p1"]);
  });
});

describe("top competitors", () => {
  it("orders by total mentions and splits each by sentiment", () => {
    const counts = topCompetitors([
      { competitor: "Jotform", sentiment: "positive" },
      { competitor: "Typeform", sentiment: "negative" },
      { competitor: "Typeform", sentiment: "negative" },
      { competitor: "Typeform", sentiment: "neutral" },
    ]);
    expect(counts.map((row) => row.competitor)).toEqual(["Typeform", "Jotform"]);
    expect(counts[0].total).toBe(3);
    expect(counts[0].sentiments).toEqual({ positive: 0, neutral: 1, negative: 2 });
    expect(counts[1].sentiments).toEqual({ positive: 1, neutral: 0, negative: 0 });
  });

  it("counts nothing when there are no mentions", () => {
    expect(topCompetitors([])).toEqual([]);
  });
});

describe("mentions over time", () => {
  const now = new Date("2026-09-05T12:00:00Z");

  it("puts each mention in its own day and keeps a competitor with none", () => {
    const series = mentionSeries(
      [
        { competitor: "Typeform", createdAt: new Date("2026-09-05T09:00:00Z") },
        { competitor: "Typeform", createdAt: new Date("2026-09-05T10:00:00Z") },
        { competitor: "Typeform", createdAt: new Date("2026-08-27T10:00:00Z") },
      ],
      ["Typeform", "Jotform"],
      30,
      now,
    );
    const typeform = series.find((row) => row.competitor === "Typeform");
    expect(typeform?.days).toHaveLength(30);
    expect(typeform?.total).toBe(3);
    expect(typeform?.days[29]).toBe(2);
    expect(series.find((row) => row.competitor === "Jotform")?.total).toBe(0);
  });

  it("ignores a mention older than the window", () => {
    const series = mentionSeries(
      [{ competitor: "Typeform", createdAt: new Date("2026-01-01T00:00:00Z") }],
      ["Typeform"],
      30,
      now,
    );
    expect(series[0].total).toBe(0);
  });
});

describe("competitors named in a thread", () => {
  const post = {
    id: "p1",
    title: "Which form builder?",
    body: "We are on Google Forms and it is not enough.",
  } as never as import("@/lib/reddit/store").StoredPost;

  function reply(id: string, body: string) {
    return { id, postId: "p1", author: "helper", body } as never as import("@/lib/reddit/store").StoredComment;
  }

  it("matches a name however a redditor writes it, each once", () => {
    expect(competitorsNamed(["Typeform", "Tally"], "typeform beats TYPEFORM for me")).toEqual([
      "Typeform",
    ]);
    expect(competitorsNamed(["  ", "Tally"], "anything")).toEqual([]);
  });

  it("quotes the sentence that named the competitor", () => {
    expect(quoteNaming("Skip Jotform. Honestly just use Typeform, it has logic.", "typeform")).toBe(
      "Honestly just use Typeform, it has logic.",
    );
    expect(quoteNaming("No product here.", "Typeform")).toBeNull();
  });

  it("names a competitor in the post, and each one a reply recommends", () => {
    const rows = threadMentions("proj", ["Typeform", "Google Forms", "Tally"], {
      post,
      comments: [reply("c1", "Try Typeform or Tally."), reply("c2", "Typeform again.")],
    });
    expect(rows.map((row) => [row.competitor, row.commentId])).toEqual([
      ["Google Forms", null],
      ["Typeform", "c1"],
      ["Tally", "c1"],
      ["Typeform", "c2"],
    ]);
    expect(rows[1].quote).toBe("Try Typeform or Tally.");
    expect(
      competitorsInThread(["Typeform", "Google Forms", "Tally"], {
        post,
        comments: [reply("c1", "Try Typeform or Tally.")],
      }),
    ).toEqual(["Typeform", "Google Forms", "Tally"]);
  });

  it("counts a mention with no sentiment in the total only", () => {
    const counts = topCompetitors([
      { competitor: "Typeform", sentiment: null },
      { competitor: "Typeform", sentiment: "negative" },
    ]);
    expect(counts[0].total).toBe(2);
    expect(counts[0].sentiments).toEqual({ positive: 0, neutral: 0, negative: 1 });
  });
});
