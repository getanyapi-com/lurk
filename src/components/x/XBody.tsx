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

/** One character for one character, so an index into the folded text is an index into the real one. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/gu, "'")
    .replace(/[“”„‟″«»]/gu, '"')
    .replace(/[‐-―−]/gu, "-")
    .replace(/…/gu, ".");
}

/**
 * An X post's text as its author wrote it, the way HighlightedBody draws a
 * Reddit body: the sentence the verdict rests on tinted, nothing altered, and
 * its links clickable, as X asks a post to be shown.
 */
export function XBody({ text, phrase, className = "text-body text-fg-muted" }: { text: string; phrase: string | null; className?: string }) {
  const at = phrase ? fold(text).indexOf(fold(phrase)) : -1;
  if (!phrase || at < 0) {
    return (
      <p className={`whitespace-pre-wrap break-words ${className}`}>
        <Linked text={text} />
      </p>
    );
  }
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      <Linked text={text.slice(0, at)} />
      <mark className="rounded-sm bg-score-warm/20 px-0.5 text-fg">
        <Linked text={text.slice(at, at + phrase.length)} />
      </mark>
      <Linked text={text.slice(at + phrase.length)} />
    </p>
  );
}
