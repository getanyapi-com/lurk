import { BrandImage } from "./BrandImage";

export const BRAND_MARKS = {
  Reddit: "/brands/reddit.svg",
  Google: "/brands/google.svg",
  "Google AI Overviews": "/brands/gemini.svg",
  ChatGPT: "/brands/chatgpt.svg",
  Perplexity: "/brands/perplexity.svg",
  Claude: "/brands/claude.svg",
  Slack: "/brands/slack-color.svg",
  Discord: "/brands/discord.svg",
} as const;
export type BrandName = keyof typeof BRAND_MARKS;

const ANSWER_ENGINES: BrandName[] = ["Google AI Overviews", "ChatGPT", "Perplexity"];

/** The three answer engines as one overlapping cluster, for "AI answers" in a heading. */
export function BrandStack() {
  return (
    <span className="brand-stack" aria-label="Google AI Overviews, ChatGPT and Perplexity">
      {ANSWER_ENGINES.map((name) => (
        <span key={name} className="brand-stack-item">
          <BrandImage name={name} src={BRAND_MARKS[name]} />
        </span>
      ))}
    </span>
  );
}

/** A platform named in running text always carries its mark. */
export function BrandWord({ name, label }: { name: BrandName; label?: string }) {
  return (
    <span className="brand-word">
      <BrandImage name={name} src={BRAND_MARKS[name]} />
      {label ?? name}
    </span>
  );
}
