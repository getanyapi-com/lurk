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
  // Black on a white disc, so it reads on both themes as Reddit's does.
  X: "/brands/x-disc.svg",
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

/**
 * A platform named in running text always carries its mark: its own from
 * BRAND_MARKS, or the `src` or favicon `domain` given for it, which win when
 * given, so a platform lurk has no file for still gets one.
 */
export function BrandWord({
  name,
  label,
  src,
  domain,
}: {
  name: string;
  label?: string;
  src?: string;
  domain?: string;
}) {
  const own = name in BRAND_MARKS ? BRAND_MARKS[name as BrandName] : undefined;
  return (
    <span className="brand-word">
      <BrandImage name={name} src={src ?? (domain ? undefined : own)} domain={domain} />
      {label ?? name}
    </span>
  );
}
