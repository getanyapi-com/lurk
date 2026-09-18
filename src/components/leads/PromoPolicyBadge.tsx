"use client";

import { usePromoPolicy } from "@/components/leads/PromoPolicy";

type PromoPolicyBadgeProps = {
  projectId: string;
  subreddit: string;
  policy: string | null;
  rulesText: string | null;
};

/** The subreddit's self-promotion rule in one line, its full rules on hover. */
export function PromoPolicyBadge({ projectId, subreddit, policy, rulesText }: PromoPolicyBadgeProps) {
  const rule = usePromoPolicy(projectId, subreddit, policy);
  if (!rule.policy) {
    return null;
  }
  return (
    <span
      className="rounded-control border px-1.5 py-0.5 text-mono text-fg-muted"
      title={rulesText ?? undefined}
    >
      {rule.policy}
    </span>
  );
}

type PromoPolicyLineProps = {
  /** Absent for a held post: nobody replies to one, so its rule is never bought. */
  projectId: string | null;
  subreddit: string;
  policy: string | null;
  rulesText: string | null;
};

/** The same rule as a line of the rail, which says so while it is being read. */
export function PromoPolicyLine({ projectId, subreddit, policy, rulesText }: PromoPolicyLineProps) {
  const rule = usePromoPolicy(projectId ?? "", projectId ? subreddit : null, policy);
  return (
    <span className="text-mono text-fg-muted" title={rulesText ?? undefined}>
      {rule.policy ?? (rule.reading ? "Reading the rules" : "-")}
    </span>
  );
}
