import { ExternalLink, ShieldCheck } from "lucide-react";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { VerdictBadge } from "@/components/VerdictBadge";
import { SubredditChip } from "@/components/SubredditChip";
import type { MockLead } from "./mockContent";

/**
 * Real saved content, laid out like the dashboard card. The score used to count
 * up from zero on the first card; there is no number on a card any more, so
 * there is nothing to animate and the badge is drawn as it stands.
 */
export function MockLeadCard({ lead }: { lead: MockLead }) {
  return (
    <article className="mock-lead">
      <div className="mock-identity">
        <AuthorAvatar name={lead.author} src={lead.avatar} size={30} />
        <span>u/{lead.author}</span>
        <SubredditChip name={lead.subreddit} iconUrl={lead.subredditIcon} />
        <VerdictBadge fit={lead.fit} intent={lead.intent} className="ml-auto" />
      </div>
      <a
        className="mock-lead-title"
        href={lead.url}
        target="_blank"
        rel="noreferrer"
      >
        {lead.title}
        <ExternalLink />
      </a>
      <div className="mock-meta">
        {lead.kind} / {lead.stage} / {lead.age}
      </div>
      <p className="mock-reason">{lead.reason}</p>
      <p className="mock-phrase">
        <mark>{lead.matchedPhrase}</mark>
      </p>
      <div className="mock-policy">
        <ShieldCheck />
        <span>{lead.promoRule}</span>
      </div>
    </article>
  );
}
