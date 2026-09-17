import { Avatar } from "@/components/Avatar";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { VerdictBadge } from "@/components/VerdictBadge";
import { SubredditChip } from "@/components/SubredditChip";
import { DetailRail } from "@/components/leads/DetailRail";
import { HighlightedBody } from "@/components/leads/HighlightedBody";
import { LeadActions } from "@/components/leads/LeadActions";
import { PromoPolicyBadge } from "@/components/leads/PromoPolicyBadge";
import { StageChip } from "@/components/leads/StageChip";
import { WorthACommentChip } from "@/components/leads/WorthACommentChip";
import { verdictFor } from "@/components/leads/verdict";
import { relativeAge } from "@/lib/format";

import type { Selection } from "@/components/leads/workspace";

type LeadDetailProps = {
  selection: Selection;
  projectId: string;
  /** The project's competitors named in the selected lead's thread. */
  competitors: string[];
};

function Pane({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

function Title({ text, badge }: { text: string; badge: React.ReactNode }) {
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
function Called({ label, sentence }: { label: string; sentence: string | null }) {
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

/** The thread a comment lead was found under, so the reply has its context. */
function ReplyingIn({ title, author, avatarUrl }: { title: string; author: string | null; avatarUrl: string | null }) {
  return (
    <div className="text-mono flex items-center gap-2 rounded-control bg-surface-2 px-2 py-1 text-fg-muted">
      <Avatar name={author} src={avatarUrl} size={16} />
      <span className="truncate">Replying in: {title}</span>
    </div>
  );
}

/** The whole post or comment, beside the ledger of facts about who wrote it. */
export function LeadDetail({ selection, projectId, competitors }: LeadDetailProps) {
  if (selection.kind === "held") {
    const item = selection.item;
    const verdict = verdictFor(item);
    return (
      <Pane>
        <header className="flex flex-col gap-2 border-b p-4">
          <Title
            text={item.title}
            badge={
              <span className="text-small text-fg-muted" style={{ fontWeight: 500 }}>
                {verdict.label}
              </span>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <AuthorAvatar name={item.author} src={item.avatarUrl} size={24} />
            <span className="text-small text-fg-muted">u/{item.author ?? "unknown"}</span>
            <SubredditChip name={item.subreddit} iconUrl={item.subredditIconUrl} />
            <span className="text-mono text-fg-muted">{relativeAge(item.createdAt)}</span>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Called label={`Held: ${verdict.label}`} sentence={item.reason} />
            <ul className="flex flex-col gap-1">
              {verdict.codes.map((code) => (
                <li key={code} className="text-small text-fg-muted">
                  {code}
                </li>
              ))}
            </ul>
          </div>
          <DetailRail
            author={item.author}
            avatarUrl={item.avatarUrl}
            authorKarma={item.authorKarma}
            authorCreatedAt={item.authorCreatedAt}
            subreddit={item.subreddit}
            subredditIconUrl={item.subredditIconUrl}
            weeklyActive={null}
            promoPolicy={null}
            rulesText={null}
            points={item.points}
            numComments={item.numComments}
            url={item.url}
            fit={item.fit}
            intent={item.intent}
            engagement={null}
            competitors={[]}
          />
        </div>
      </Pane>
    );
  }

  const lead = selection.entry.lead;
  return (
    <Pane>
      <header className="flex flex-col gap-2 border-b p-4">
        <Title text={lead.title} badge={<VerdictBadge fit={lead.fit} intent={lead.intent} />} />
        <div className="flex flex-wrap items-center gap-2">
          <AuthorAvatar name={lead.author} src={lead.avatarUrl} size={24} />
          <span className="text-small text-fg-muted">u/{lead.author ?? "unknown"}</span>
          <SubredditChip name={lead.subreddit} iconUrl={lead.subredditIconUrl} />
          <span className="text-mono text-fg-muted">{relativeAge(lead.createdAt)}</span>
          <StageChip stage={lead.stage} />
          <WorthACommentChip kind={lead.kind} />
          <PromoPolicyBadge policy={lead.promoPolicy} rulesText={lead.rulesText} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Called label="Why this is a lead" sentence={lead.reason} />
          {lead.isComment ? (
            <ReplyingIn
              title={lead.title}
              author={lead.postAuthor}
              avatarUrl={lead.postAuthorAvatar}
            />
          ) : null}
          {lead.body ? (
            <HighlightedBody text={lead.body} phrase={lead.matchedPhrase} />
          ) : (
            <p className="text-body text-fg-muted">A title only, with no text of its own.</p>
          )}
        </div>
        <DetailRail
          author={lead.author}
          avatarUrl={lead.avatarUrl}
          authorKarma={lead.authorKarma}
          authorCreatedAt={lead.authorCreatedAt}
          subreddit={lead.subreddit}
          subredditIconUrl={lead.subredditIconUrl}
          weeklyActive={lead.subredditWeeklyActive}
          promoPolicy={lead.promoPolicy}
          rulesText={lead.rulesText}
          points={lead.points}
          numComments={lead.numComments}
          url={lead.url}
          fit={lead.fit}
          intent={lead.intent}
          engagement={lead.engagement}
          competitors={competitors}
        />
      </div>
      <LeadActions
        projectId={projectId}
        leadId={lead.id}
        url={lead.url}
        title={lead.title}
        subreddit={lead.subreddit}
        promoPolicy={lead.promoPolicy}
      />
    </Pane>
  );
}
