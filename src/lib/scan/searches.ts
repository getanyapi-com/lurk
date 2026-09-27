import { z } from "zod";
import { generateStructured } from "@/lib/llm";
import { productState, type ProductFacts } from "@/lib/product";
import { SWEEP_SEARCHES_SYSTEM } from "@/lib/prompts";
import { askedText } from "@/lib/discovery/rank";

const KINDS = ["tool_ask", "alternative_to", "symptom", "acting_for", "workaround", "moment"] as const;

const schema = z.object({
  searches: z.array(z.object({ kind: z.enum(KINDS), text: z.string() })),
});

/** The most searches one sweep adds, whatever the model returns. */
const MOST = 20;

/**
 * The searches a first sweep adds to the page's own phrasings: one model call,
 * about 5 seconds and $0.0002 at minimal effort. The first Reddit search waits
 * on it, so it was measured 2026-09-25 against low (.context/fast/min): 12.1 s
 * to 5.3 s at the median, and on one Reddit page each of the 236 searches only
 * one effort wrote, for 15 products, 542 buyer leads against 541. They are
 * asked of Reddit and never stored as phrasings, which also feed Google
 * discovery and the Reddit SEO tab, where a rival's name has no place. A sweep without them is still a sweep, so a call
 * that fails or an instance with no model key adds nothing and says nothing.
 */
export async function sweepSearches(projectId: string, product: ProductFacts): Promise<string[]> {
  try {
    const made = await generateStructured({
      purpose: "sweep_searches",
      projectId,
      schema,
      effort: "minimal",
      system: SWEEP_SEARCHES_SYSTEM,
      prompt: JSON.stringify({ product: productState(product) }),
    });
    const texts = made.searches.map((item) => askedText(item.text)).filter((text) => text.length > 0);
    return [...new Set(texts)].slice(0, MOST);
  } catch {
    return [];
  }
}
