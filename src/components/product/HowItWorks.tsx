"use client";

import { type CSSProperties, useEffect, useState } from "react";
import "./how-steps.css";

/**
 * Why a site goes in the field beside this: the four things that follow from
 * it, drawn the way the home page draws the product, as a pastel tile with a
 * piece of the app floating on it, and played one step after another. Every
 * word on a card is a stand-in; none of it is a number or a claim about this
 * account.
 */

const STEP_MS = 1700;
/** How long the finished picture is left up before it plays again. */
const HOLD_MS = 3500;

const at = (i: number) => ({ "--i": i }) as CSSProperties;

function Mark({ src, alt, size = 16 }: { src: string; alt: string; size?: number }) {
  // Brand art, not a themed surface.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} className="shrink-0 rounded-full" />;
}

/** A site's address going in, and what it sells coming out. */
function ReadArt() {
  return (
    <div className="how-card">
      <span className="how-type font-mono text-fg-muted">https://yourproduct.com</span>
      <div className="flex flex-wrap gap-1">
        {["what you sell", "who buys it", "how they ask"].map((word, index) => (
          <span key={word} style={at(index + 5)} className="how-pop rounded-full border bg-surface-2 px-2 py-0.5 text-[11px]">
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Threads going past, and the one that is a buyer kept. */
function ThreadsArt() {
  const rows: [string, boolean][] = [
    ["Show off your weekend project", false],
    ["Is there a tool that does this?", true],
    ["Weekly discussion thread", false],
  ];
  return (
    <div className="how-card">
      {rows.map(([title, lead], index) => (
        <div key={title} className={`how-in flex items-center gap-2 ${lead ? "" : "how-fade"}`} style={{ ...at(index), opacity: lead ? 1 : 0.4 }}>
          <Mark src="/brands/reddit.svg" alt="" size={14} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {lead ? (
            <span className="how-pop rounded-full px-2 py-0.5 font-mono text-[10px] text-white" style={{ ...at(5), background: "var(--score-hot)" }}>
              lead
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The reply under their question. */
function ReplyArt() {
  return (
    <div className="how-card">
      <div className="how-in flex items-center gap-2" style={at(0)}>
        <span className="size-4 shrink-0 rounded-full bg-surface-2" />
        <span className="truncate text-fg-muted">Is there a tool that does this?</span>
      </div>
      <div className="how-in ml-2 flex items-center gap-2 border-l pl-3" style={at(3)}>
        <span className="size-4 shrink-0 rounded-full" style={{ background: "var(--score-hot)" }} />
        <span className="truncate">You, while they are still looking</span>
      </div>
    </div>
  );
}

/** The assistants that read Reddit for their answers. */
function CitedArt() {
  return (
    <div className="how-card">
      <div className="flex items-center gap-2">
        {["chatgpt", "claude", "gemini", "perplexity", "google"].map((name, index) => (
          <span key={name} className="how-pop inline-flex" style={at(index)}>
            <Mark src={`/brands/${name}.svg`} alt={name} size={18} />
          </span>
        ))}
      </div>
      <span className="how-in" style={at(5)}>
        &ldquo;People on Reddit recommend <span style={{ color: "var(--score-hot)" }}>yourproduct</span>&hellip;&rdquo;
      </span>
    </div>
  );
}

const STEPS: { tone: string; title: string; line: string; art: React.ReactNode }[] = [
  { tone: "how-pink", title: "We read your site.", line: "What you sell and who buys it, worked out from the page.", art: <ReadArt /> },
  { tone: "how-teal", title: "We find the threads.", line: "A year of Reddit, kept only where someone is asking for it.", art: <ThreadsArt /> },
  { tone: "how-mint", title: "You reply or DM.", line: "Each lead opens on Reddit, with why it fits.", art: <ReplyArt /> },
  { tone: "how-peach", title: "AI starts citing you.", line: "Assistants answer from Reddit threads, so your replies become their sources.", art: <CitedArt /> },
];

export function HowItWorks() {
  // The step now playing; one past the last is the finished picture, held.
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setTimeout(
      () => setStep((now) => (now >= STEPS.length ? 0 : now + 1)),
      step >= STEPS.length ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [step]);
  return (
    <div className="how-steps">
      {STEPS.map((item, index) => (
        <figure
          key={item.title}
          className="how-step"
          data-state={index < step ? "done" : index === step ? "active" : "todo"}
        >
          <div className={`how-art ${item.tone}`}>{item.art}</div>
          <figcaption>
            <em>{index + 1}</em>
            <strong>{item.title}</strong> {item.line}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
