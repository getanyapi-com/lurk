import type { projects } from "@/db/schema";
import { parseTextList } from "@/lib/discovery/store";
import { usableBrief, type ProductBrief } from "./brief";

/**
 * What the product's own page said it is, as every judgement reads it. One
 * shape for the scan, discovery and the SEO refresh, so a fact the profile
 * learned is named the same way everywhere it is judged against.
 */
export type ProductFacts = {
  name: string;
  url: string | null;
  pain: string;
  solution: string;
  targetUsers: string;
  serviceGeography: string;
  budgetFit: string;
  capabilities: string[];
  exclusions: string[];
  notBuyers: string[];
  competitors: string[];
  /** What the judge reads beside the facts (lib/brief.ts). Absent until the project has one. */
  brief?: ProductBrief | null;
};

/** The facts as the projects row holds them, with the competitors a scan may name. */
export function productFacts(
  row: typeof projects.$inferSelect,
  competitors: string[],
): ProductFacts {
  return {
    name: row.name,
    url: row.url,
    pain: row.pain ?? "",
    solution: row.solution ?? "",
    targetUsers: row.targetUsers ?? "",
    serviceGeography: row.geography ?? "",
    budgetFit: row.budgetFit ?? "",
    capabilities: parseTextList(row.capabilities),
    exclusions: parseTextList(row.exclusions),
    notBuyers: parseTextList(row.notBuyers),
    competitors,
    brief: usableBrief(row.brief),
  };
}

/**
 * The product as the `product` object in a Jev request. Every field is named
 * for what it is, because the questions point at them by path
 * (`product.capabilities`, `product.does_not`) and the model reads the names.
 * Empty facts are left out rather than sent as empty strings, so a question
 * about a fact the page never gave has nothing to match and says unknown.
 */
export function productState(facts: ProductFacts): Record<string, unknown> {
  const state: Record<string, unknown> = { name: facts.name };
  const put = (key: string, value: string | string[] | null) => {
    if (value && value.length > 0) {
      state[key] = value;
    }
  };
  put("website", facts.url);
  put("pain_it_solves", facts.pain);
  put("what_it_does", facts.solution);
  put("who_buys_it", facts.targetUsers);
  put("capabilities", facts.capabilities);
  put("does_not", facts.exclusions);
  put("not_a_buyer", facts.notBuyers);
  put("serves_in", facts.serviceGeography);
  put("budget", facts.budgetFit);
  put("competitors", facts.competitors);
  if (facts.brief) {
    put("kind", facts.brief.kind);
    put("price", facts.brief.price);
    put("sold_to", facts.brief.buyers);
  }
  return state;
}

/**
 * The same facts as one block of text, for the calls that still read prose:
 * the SEO refresh, the competitor scan and the discovery brief.
 */
export function productText(facts: ProductFacts): string {
  return [
    `Product: ${facts.name}`,
    facts.url ? `Website: ${facts.url}` : "",
    facts.pain ? `Pain it solves: ${facts.pain}` : "",
    facts.solution ? `What it does: ${facts.solution}` : "",
    facts.targetUsers ? `Who buys it: ${facts.targetUsers}` : "",
    facts.capabilities.length > 0 ? `Can: ${facts.capabilities.join("; ")}` : "",
    facts.exclusions.length > 0 ? `Does not: ${facts.exclusions.join("; ")}` : "",
    facts.notBuyers.length > 0 ? `Not a buyer: ${facts.notBuyers.join("; ")}` : "",
    facts.serviceGeography ? `Sells in: ${facts.serviceGeography}` : "",
    facts.budgetFit ? `Budget: ${facts.budgetFit}` : "",
    facts.competitors.length > 0 ? `Competitors: ${facts.competitors.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
