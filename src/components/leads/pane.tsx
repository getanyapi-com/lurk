/**
 * The parts every detail pane is built from, Reddit's, X's and the SEO tab's
 * alike: the pane itself, its title line, the plain-words reason the scan
 * gave, and one block of the ledger beside the post.
 */

/** The pane itself: one column filling the height the workspace gives it. */
export function Pane({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

/** The post's title, with the verdict it was given at the far end of the line. */
export function Title({ text, badge }: { text: string; badge: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-h3 text-fg" style={{ fontWeight: 500 }}>
        {text}
      </h3>
      <span className="shrink-0 pt-1">{badge}</span>
    </div>
  );
}

/** One labelled line of plain words: why the scan called this what it called it. */
export function Called({ label, sentence }: { label: string; sentence: string | null }) {
  if (!sentence) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1 rounded-card bg-surface-2 p-3">
      <span className="text-mono tracking-wide text-fg-muted uppercase">{label}</span>
      <p className="text-small text-fg">{sentence}</p>
    </section>
  );
}

/** One labelled block of a ledger, ruled off from the next. */
export function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b p-3 last:border-b-0">
      <span className="text-mono tracking-wide text-fg-muted uppercase">{label}</span>
      {children}
    </div>
  );
}
