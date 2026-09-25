import { z } from "zod";
import { generateStructured } from "@/lib/llm";
import { productState, type ProductFacts } from "@/lib/product";
import { SWEEP_SEARCHES_SYSTEM } from "@/lib/prompts";
import { askedText } from "@/lib/discovery/rank";

/** Ordered by how many leads a search of each kind found per 100 posts in the 2026-09-19 experiment. */
export const KINDS = ["tool_ask", "alternative_to", "symptom", "acting_for", "workaround", "moment"] as const;

export type SweepSearch = { kind: (typeof KINDS)[number]; text: string };

const schema = z.object({
  searches: z.array(z.object({ kind: z.enum(KINDS), text: z.string() })),
});

/** The most searches one sweep adds, whatever the model returns. */
const MOST = 20;

/**
 * The searches a first sweep adds to the page's own phrasings: one model call,
 * about 14 seconds and $0.0004. They are asked of Reddit and never stored as
 * phrasings, which also feed Google discovery and the Reddit SEO tab, where a
 * rival's name has no place. A sweep without them is still a sweep, so a call
 * that fails or an instance with no model key adds nothing and says nothing.
 */
export async function sweepSearches(projectId: string, product: ProductFacts): Promise<string[]> {
  return (await sweepSearchItems(projectId, product)).map((item) => item.text);
}

/** The same searches with the kind each was written as, deduplicated, in the model's order. */
export async function sweepSearchItems(
  projectId: string,
  product: ProductFacts,
): Promise<SweepSearch[]> {
  try {
    const made = await generateStructured({
      purpose: "sweep_searches",
      projectId,
      schema,
      system: SWEEP_SEARCHES_SYSTEM,
      prompt: JSON.stringify({ product: productState(product) }),
    });
    const seen = new Set<string>();
    const items: SweepSearch[] = [];
    for (const item of made.searches) {
      const text = askedText(item.text);
      if (text.length > 0 && !seen.has(text)) {
        seen.add(text);
        items.push({ kind: item.kind, text });
      }
    }
    return items.slice(0, MOST);
  } catch {
    return [];
  }
}
