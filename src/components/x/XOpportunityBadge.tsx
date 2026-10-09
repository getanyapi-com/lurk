import { VerdictBadge } from "@/components/VerdictBadge";
import { X_PRIORITY_FLOOR } from "@/lib/x/priority";
import type { XOpportunity } from "@/lib/x/read";
import { XReplyChip } from "./XReplyChip";

/** Describe the evidence, without presenting the internal ordering as a probability. */
export function XOpportunityBadge({ opportunity, ranked = true }: { opportunity: XOpportunity; ranked?: boolean }) {
  const { entry, priority, checks } = opportunity;
  const weaker = ranked && (priority === null || priority < X_PRIORITY_FLOOR);
  if (!weaker && (!ranked || checks.length === 0) && entry.kind === "lead") {
    return entry.lead.kind === "reply"
      ? <XReplyChip moment={entry.lead.moment} />
      : <VerdictBadge fit={entry.lead.fit} intent={entry.lead.intent} />;
  }
  const word = weaker ? priority === null ? "Unassessed" : "Weaker match" : checks.length ? "Check fit" : "Worth a look";
  const hint = weaker
    ? priority === null ? "Not enough evidence to assess this opportunity yet." : "Less evidence of a useful opportunity. You can still review the post."
    : checks.length ? checks.join(" · ") : "Potentially relevant; review the post before replying.";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-mono whitespace-nowrap ${weaker ? "text-fg-muted" : "text-score-warm"}`} title={hint}>
      {word}
    </span>
  );
}
