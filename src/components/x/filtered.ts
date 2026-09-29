import type { XFiltered, XFilteredCard } from "@/lib/x/read";

/**
 * Why a post was left out, in the words the X tab shows: a short word for its
 * row and a sentence for its pane. A judged post's sentence is the one the
 * gates wrote (gates.ts reasonFrom); a screened post was never read by the
 * judge, so the rule that set it aside is the reason, said as what the rule
 * tests (screen.ts freeScreen).
 */

type Words = { word: string; sentence: string };

const SCREEN: Record<string, Words> = {
  stale: { word: "too old", sentence: "Older than the window this search reads." },
  other_language: { word: "other language", sentence: "Not written in your product's language." },
  too_long: { word: "article", sentence: "Over 4,000 characters: an article, not someone asking." },
  bare_link: { word: "just a link", sentence: "Little more than a link or a handle, with nothing to read." },
  own_or_rival_account: {
    word: "own or rival",
    sentence: "Posted by your own account or by one of the products you compete with.",
  },
  reply_farm: {
    word: "reply farm",
    sentence: "Its author has posts in three or more threads among what this search found, which is how reply farms work.",
  },
  vendor_launch: { word: "launch", sentence: "Someone announcing a product they built, not asking for one." },
  machine_query: { word: "@grok", sentence: "Written by Grok or mentioning @grok." },
  job_or_gig: { word: "job post", sentence: "A job ad, or a freelancer offering their work." },
  trading_or_crypto: { word: "trading", sentence: "About trading or crypto." },
  listicle: {
    word: "list",
    sentence: "A numbered or bulleted list written for readers, such as tools, alternatives or steps, rather than someone asking.",
  },
  vendor_promo: { word: "ad", sentence: "An ad or a discount for a product." },
  vendor_hook: { word: "pitch", sentence: "A vendor using a buyer's words to pitch their own product." },
  no_visible_term: {
    word: "no match",
    sentence:
      "The words lurk searched for are not together in one sentence the author wrote: X matched it on words sentences apart, or on something the author did not write, such as a username, a link card or a quoted post.",
  },
  no_ask: { word: "no ask", sentence: "Nothing in it asks for anything." },
};

const JUDGED: Record<string, string> = {
  no_active_need: "no need",
  wrong_job: "other job",
  seller_only: "seller",
  resolved: "sorted",
  automated_account: "automated",
};

/** Codes whose failing answer is half of fit itself, so a close call on one sat near that answer's line. */
const INSIDE_FIT = new Set(["no_active_need", "wrong_job"]);

/** The row's word for why it was left out. */
export function filteredWord(card: Pick<XFilteredCard, "kind" | "code">): string {
  if (card.kind === "screened") {
    return SCREEN[card.code ?? ""]?.word ?? "screened";
  }
  if (card.kind === "unfinished") {
    return "unfinished";
  }
  return JUDGED[card.code ?? ""] ?? "not a lead";
}

/** The judge's 0-100 score as the 0-4 bar a row shows: 30, the worth-a-look line, fills two. */
export function filteredStrength(score: number | null): number | null {
  if (score === null) return null;
  return score >= 50 ? 4 : score >= 40 ? 3 : score >= 30 ? 2 : score >= 20 ? 1 : 0;
}

/** The pane's sentence for why it was left out. */
export function filteredSentence(card: Pick<XFilteredCard, "kind" | "code" | "reason" | "replyChecked" | "closeCall">): string {
  if (card.kind === "screened") {
    const rule = SCREEN[card.code ?? ""]?.sentence ?? "Set aside by one of lurk's rules.";
    const set = `${rule} lurk sets posts like this aside by rule, before the judge reads anything.`;
    // rescore.ts gives a screened post one read afterwards, only to rank it here.
    return card.reason ? `${set} A quick read afterwards, used only to order this list: ${card.reason}` : set;
  }
  if (card.kind === "unfinished") {
    return "It passed the judge's first read, but lurk never finished checking it (its author's profile and a second read) before it aged out, so it was never shown. Check it yourself.";
  }
  const parts = [card.reason ?? "The judge read it and turned it away."];
  if (card.closeCall) {
    parts.push(
      INSIDE_FIT.has(card.code ?? "")
        ? "That answer was near the line, and they read as close to acting, so check it yourself."
        : "It still reads as someone needing this kind of product and close to acting, so check it yourself.",
    );
  }
  if (card.replyChecked) {
    parts.push("lurk also checked whether it was worth a reply, and it was not.");
  }
  return parts.join(" ");
}

/** The line under Left out: what lurk read and set aside, so the count reads as work done. */
export function filteredSummary({ items, judged, screened, unfinished, worth, pending }: XFiltered): string {
  const parts = ["Read and set aside. Each row says why; the bar is the judge's score."];
  const listed = items.filter((item) => item.band !== "worth").length;
  if (pending > 0) {
    parts.push(`lurk is still reading ${pending} more.`);
  }
  if (listed < judged + screened + unfinished - worth) {
    parts.push(`The first ${listed} are listed.`);
  }
  return parts.join(" ");
}

/** What the empty list adds when there is something below it: where to look next. */
export function filteredPointer({ items, worth }: XFiltered, held = 0): string | null {
  const maybe = worth + held;
  if (maybe > 0) {
    return `${maybe === 1 ? "One post" : `${maybe} posts`} under Maybe below ${maybe === 1 ? "is" : "are"} worth checking yourself.`;
  }
  return items.length > 0 ? "What lurk read and set aside, and why, is under Left out below." : null;
}
