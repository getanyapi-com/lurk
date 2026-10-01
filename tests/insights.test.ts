import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateStructured = vi.fn();

vi.mock("@/lib/llm", () => ({ generateStructured }));
vi.mock("@/db", () => ({ db: () => ({}) }));

const { MAX_THEMES, THEME_BATCH_SIZE, clusterLeads, mergeThemes } = await import(
  "@/lib/insights/themes"
);
const { themeHref, themeQuotes } = await import("@/lib/insights/read");

type Input = Parameters<typeof clusterLeads>[1];

function leadsNamed(count: number): Input {
  return Array.from({ length: count }, (_, index) => ({
    id: `lead-${index}`,
    title: `Post ${index}`,
    reason: "asked for a recommendation",
    matchedPhrase: "looking for something cheaper",
    stage: "solution_seeking",
  }));
}

describe("theme assembly", () => {
  it("puts the biggest theme first and keeps a lead in one theme", () => {
    const merged = mergeThemes(
      [
        [
          { label: "Pricing", summary: "Too expensive", leadIds: ["a"] },
          { label: "Onboarding", summary: "Hard to start", leadIds: ["b", "c"] },
        ],
      ],
      ["a", "b", "c"],
    );
    expect(merged.map((theme) => theme.label)).toEqual(["Onboarding", "Pricing"]);
    expect(merged[0].leadIds).toEqual(["b", "c"]);
  });

  it("folds the same label from two batches into one theme", () => {
    const merged = mergeThemes(
      [
        [{ label: "Pricing", summary: "Too expensive", leadIds: ["a"] }],
        [{ label: "pricing ", summary: "Cost again", leadIds: ["b"] }],
      ],
      ["a", "b"],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].leadIds).toEqual(["a", "b"]);
    expect(merged[0].summary).toBe("Too expensive");
  });

  it("drops a lead id the model invented and a lead it repeated", () => {
    const merged = mergeThemes(
      [
        [
          { label: "Pricing", summary: "Cost", leadIds: ["a", "made-up"] },
          { label: "Support", summary: "Slow replies", leadIds: ["a"] },
        ],
      ],
      ["a"],
    );
    expect(merged).toEqual([{ label: "Pricing", summary: "Cost", leadIds: ["a"] }]);
  });

  it("shows no more themes than the screen has room for", () => {
    const themes = Array.from({ length: MAX_THEMES + 3 }, (_, index) => ({
      label: `Theme ${index}`,
      summary: "One sentence",
      leadIds: [`lead-${index}`],
    }));
    const ids = themes.map((theme) => theme.leadIds[0]);
    expect(mergeThemes([themes], ids)).toHaveLength(MAX_THEMES);
  });
});

describe("clustering calls", () => {
  beforeEach(() => {
    generateStructured.mockReset();
  });

  it("sends one call per batch and merges what comes back", async () => {
    generateStructured.mockImplementation(async (call: { prompt: string }) => ({
      themes: [
        {
          label: "Pricing",
          summary: "Too expensive",
          leadIds: [...call.prompt.matchAll(/id: (lead-\d+)/g)].map((match) => match[1]),
        },
      ],
    }));
    const items = leadsNamed(THEME_BATCH_SIZE + 1);
    const themes = await clusterLeads("project-1", items);
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[0][0].purpose).toBe("insights");
    expect(themes).toHaveLength(1);
    expect(themes[0].leadIds).toHaveLength(items.length);
  });

  it("merges the batches in the order they were cut, whichever answers first", async () => {
    // The first batch answers last. Both claim lead-0 under their own label,
    // and the first batch's claim is the one that stands, as it did when the
    // calls were made one after the other.
    generateStructured.mockImplementation(async (call: { prompt: string }) => {
      const first = call.prompt.includes("id: lead-0 ");
      await new Promise((resolve) => setTimeout(resolve, first ? 20 : 0));
      return {
        themes: [{ label: first ? "First" : "Second", summary: "s", leadIds: ["lead-0"] }],
      };
    });
    const themes = await clusterLeads("project-1", leadsNamed(THEME_BATCH_SIZE + 1));
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(themes.map((theme) => [theme.label, theme.leadIds])).toEqual([["First", ["lead-0"]]]);
  });

  it("asks nothing when there is nothing to group", async () => {
    expect(await clusterLeads("project-1", [])).toEqual([]);
    expect(generateStructured).not.toHaveBeenCalled();
  });
});

describe("the quotes a theme card shows", () => {
  it("keys quotes by theme and drops a lead that said nothing", () => {
    const quotes = themeQuotes([
      { themeId: "theme-a", phrase: "we fill the same form every time" },
      { themeId: "theme-a", phrase: "   " },
      { themeId: "theme-a", phrase: null },
      { themeId: "theme-b", phrase: "paying per seat for people who never log in" },
    ]);
    expect([...quotes.keys()]).toEqual(["theme-a", "theme-b"]);
    expect(quotes.get("theme-a")).toEqual(["we fill the same form every time"]);
    expect(quotes.get("theme-b")).toEqual(["paying per seat for people who never log in"]);
  });

  it("quotes one phrase once, however many leads matched it", () => {
    const quotes = themeQuotes([
      { themeId: "theme-a", phrase: "prefilled forms" },
      { themeId: "theme-a", phrase: " prefilled forms " },
    ]);
    expect(quotes.get("theme-a")).toEqual(["prefilled forms"]);
  });
});

describe("the link from a theme to its leads", () => {
  it("carries the project and the theme id the feed filters on", () => {
    expect(themeHref("project-1", "theme-a")).toBe(
      "/app/leads?project=project-1&theme=theme-a",
    );
  });

  it("is the only place the card builds that href", () => {
    const card = readFileSync("src/components/insights/ThemeCard.tsx", "utf8");
    expect(card).toContain("themeHref(projectId, theme.id)");
    expect(card).not.toContain("/app/leads");
  });
});
