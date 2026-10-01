import { foldQuotes } from "@/lib/scan/evidence";

type HighlightedBodyProps = {
  text: string;
  phrase: string | null;
  /** Make its links clickable, and let a long word break to fit, as X asks a post to be shown. */
  linkify?: boolean;
  className?: string;
};

const URL_PATTERN = /(https?:\/\/[^\s]+)/gu;

/** Text with its links made clickable, never otherwise changed. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * One character for one character, so an index into the folded text is an
 * index into the real one. The phrase the scan stored is in plain typography
 * while Reddit's and X's text keep their curly quotes, long dashes and
 * ellipses.
 */
function fold(text: string): string {
  return foldQuotes(text.toLowerCase()).replace(/\u2026/g, ".");
}

/**
 * A post or comment's text as its author wrote it, with the phrase that won
 * the match tinted and nothing altered. An X post also has its links made
 * clickable.
 */
export function HighlightedBody({
  text,
  phrase,
  linkify = false,
  className = "text-body text-fg-muted",
}: HighlightedBodyProps) {
  const at = phrase ? fold(text).indexOf(fold(phrase)) : -1;
  const shown = (part: string) => (linkify ? <Linked text={part} /> : part);
  const classes = `whitespace-pre-wrap ${linkify ? "break-words " : ""}${className}`;
  if (!phrase || at < 0) {
    return <p className={classes}>{shown(text)}</p>;
  }
  return (
    <p className={classes}>
      {shown(text.slice(0, at))}
      <mark className="rounded-sm bg-score-warm/20 px-0.5 text-fg">
        {shown(text.slice(at, at + phrase.length))}
      </mark>
      {shown(text.slice(at + phrase.length))}
    </p>
  );
}
