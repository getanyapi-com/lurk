/**
 * Why a site goes in the field beside this: the four things that follow from
 * it, each drawn as the small piece of the product that does it. Everything
 * here is a picture of the real thing with stand-in words, never a number.
 */

function Art({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[76px] flex-col justify-center gap-1.5 rounded-control border bg-surface-2 p-3">
      {children}
    </div>
  );
}

function Mark({ src, alt, size = 16 }: { src: string; alt: string; size?: number }) {
  // Brand art, not a themed surface.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} className="shrink-0 rounded-full" />;
}

/** A site's address going in, and what it sells coming out. */
function ReadArt() {
  return (
    <Art>
      <span className="truncate font-mono text-[12px] text-fg-muted">https://yourproduct.com</span>
      <div className="flex flex-wrap gap-1">
        {["what you sell", "who buys it", "how they ask for it"].map((word) => (
          <span key={word} className="rounded-full border bg-surface px-2 py-0.5 text-[11px] text-fg">
            {word}
          </span>
        ))}
      </div>
    </Art>
  );
}

/** Threads going past, and the one that is a buyer kept. */
function ThreadsArt() {
  const rows: [string, boolean][] = [
    ["Show off your weekend project", false],
    ["Is there a tool that does this for me?", true],
    ["Weekly discussion thread", false],
  ];
  return (
    <Art>
      {rows.map(([title, lead]) => (
        <div key={title} className="flex items-center gap-2" style={{ opacity: lead ? 1 : 0.45 }}>
          <Mark src="/brands/reddit.svg" alt="" size={14} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{title}</span>
          {lead ? (
            <span className="rounded-full px-2 py-0.5 font-mono text-[10px] text-white" style={{ background: "var(--score-hot)" }}>
              lead
            </span>
          ) : null}
        </div>
      ))}
    </Art>
  );
}

/** The reply under their question. */
function ReplyArt() {
  return (
    <Art>
      <div className="flex items-center gap-2">
        <span className="size-4 shrink-0 rounded-full bg-surface" style={{ boxShadow: "0 0 0 1px var(--border)" }} />
        <span className="truncate text-[12px] text-fg-muted">Is there a tool that does this for me?</span>
      </div>
      <div className="ml-2 flex items-center gap-2 border-l pl-3">
        <span className="size-4 shrink-0 rounded-full" style={{ background: "var(--score-hot)" }} />
        <span className="truncate text-[12px] text-fg">You, with the answer, while they are still looking</span>
      </div>
    </Art>
  );
}

/** The assistants that read Reddit for their answers. */
function CitedArt() {
  return (
    <Art>
      <div className="flex items-center gap-2">
        {["chatgpt", "claude", "gemini", "perplexity", "google"].map((name) => (
          <Mark key={name} src={`/brands/${name}.svg`} alt={name} size={18} />
        ))}
      </div>
      <span className="text-[12px] text-fg">
        &ldquo;People on Reddit recommend <span style={{ color: "var(--score-hot)" }}>yourproduct</span>&hellip;&rdquo;
      </span>
    </Art>
  );
}

const STEPS: { title: string; line: string; art: React.ReactNode }[] = [
  { title: "We read your site", line: "What you sell and who buys it, worked out from the page.", art: <ReadArt /> },
  { title: "We find the threads", line: "A year of Reddit, kept only where someone is asking for what you sell.", art: <ThreadsArt /> },
  { title: "You reply or DM", line: "Each lead opens on Reddit, with what they asked and why it fits.", art: <ReplyArt /> },
  { title: "AI starts citing you", line: "Assistants answer from Reddit threads, so your replies become their sources.", art: <CitedArt /> },
];

export function HowItWorks() {
  return (
    <ol className="flex flex-col">
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex gap-4">
          <div className="flex flex-col items-center">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-surface font-mono text-[11px] text-fg-muted">
              {index + 1}
            </span>
            {index < STEPS.length - 1 ? <span className="w-px flex-1" style={{ background: "var(--border)" }} /> : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 pb-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-body text-fg" style={{ fontWeight: 500 }}>{step.title}</span>
              <span className="text-small text-fg-muted">{step.line}</span>
            </div>
            {step.art}
          </div>
        </li>
      ))}
    </ol>
  );
}
