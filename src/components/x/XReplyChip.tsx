import { MessagesSquare } from "lucide-react";

/** What kind of place a reply-worthy post is, in the words its chip shows. */
const MOMENT_WORDS: Record<string, string> = {
  has_the_problem: "Has the problem",
  workflow: "Shows their workflow",
  building_their_own: "Building their own",
  price_gripe: "Price gripe",
  open_question: "Asking around",
};

export function momentWords(moment: string | null | undefined): string {
  return (moment && MOMENT_WORDS[moment]) || "Worth a reply";
}

/**
 * Marks a post nobody is shopping in but worth answering, where an ask gets
 * its VerdictBadge: the chip Reddit's "Worth a comment" lane wore
 * (WorthACommentChip), in the same place and the same quiet style, naming
 * what kind of place it is.
 */
export function XReplyChip({ moment }: { moment?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control bg-surface-2 px-2 py-0.5 text-mono whitespace-nowrap text-fg-muted">
      <MessagesSquare className="size-3.5 shrink-0" aria-hidden="true" />
      {momentWords(moment)}
    </span>
  );
}
