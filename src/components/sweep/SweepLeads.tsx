"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, X } from "lucide-react";
import { sweepThreadAction } from "@/app/app/leads/actions";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { HighlightedBody } from "@/components/leads/HighlightedBody";
import { ScrollLock } from "@/components/ScrollLock";
import { SubredditChip } from "@/components/SubredditChip";
import { VerdictBadge } from "@/components/VerdictBadge";
import { shortAge } from "@/lib/format";
import { fitWord, intentWord } from "@/lib/scan/words";
import type { SweepThread } from "@/lib/sweep";

/** Where the sweep cuts each body it hands the board; see BODY_CHARS in lib/sweep. */
const SNIPPET_CHARS = 220;

const VERDICT_WORD = { qualify: "yes, a lead", review: "maybe, held for review", reject: "no" } as const;

/** What Jev answered about a thread, as six questions and their answers. */
export function jevAnswers(thread: SweepThread): [string, string][] {
  const verdict = thread.verdict;
  if (!verdict) {
    return [];
  }
  return [
    ["Who is this person to you?", verdict.relationship.replace(/_/g, " ")],
    ["Is the need still open?", verdict.needState.replace(/_/g, " ")],
    ["Which sentence says so?", verdict.quote ? `"${verdict.quote}"` : "none"],
    ["Does what you sell solve it?", fitWord(verdict.fit) ?? "-"],
    ["How hard are they asking?", intentWord(verdict.intent) ?? "-"],
    ["Worth a reply?", `${VERDICT_WORD[verdict.decision]} · ${verdict.score}`],
  ];
}

type Detail = { body: string | null; entry: string | null };

/**
 * One lead, slid up from the bottom over the board. The board keeps running
 * under it, so closing it lands you where you were rather than on a page that
 * has to be read again.
 *
 * The board only carries the opening of each post, so the shelf reads the rest
 * as it opens, and whether the post is in the feed yet: once it is, the full
 * lead, with its reply tools, is one tap away.
 */
function Shelf({
  thread,
  projectId,
  onClose,
}: {
  thread: SweepThread;
  projectId?: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reading, setReading] = useState(Boolean(projectId));
  useEffect(() => {
    if (!projectId) {
      return;
    }
    let gone = false;
    sweepThreadAction(projectId, thread.id)
      .then((read) => {
        if (!gone) setDetail(read);
      })
      .catch(() => {})
      .finally(() => {
        if (!gone) setReading(false);
      });
    return () => {
      gone = true;
    };
  }, [projectId, thread.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows = jevAnswers(thread);
  const body = detail?.body ?? thread.body;
  // The sweep cuts every body at the same length, so one that long was cut.
  const cut = !detail && (thread.body?.length ?? 0) >= SNIPPET_CHARS;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={thread.title}>
      <ScrollLock />
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/40" style={{ animation: "shelfFade 200ms ease-out" }} />
      <div
        className="relative flex max-h-[85dvh] flex-col rounded-t-card border-t bg-surface"
        style={{ animation: "shelfUp 260ms cubic-bezier(0.2, 0.8, 0.2, 1)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex shrink-0 items-start gap-2.5 border-b px-4 pt-4 pb-3">
          <AuthorAvatar name={thread.author ?? null} size={28} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-body text-fg" style={{ fontWeight: 500 }}>
              {thread.title}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <SubredditChip name={thread.subreddit} iconUrl={null} />
              {thread.author ? <span className="text-mono text-fg-muted">u/{thread.author}</span> : null}
              <span className="text-mono text-fg-muted">{shortAge(new Date(thread.createdAt))}</span>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 p-1 text-fg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {thread.verdict ? (
              <VerdictBadge fit={thread.verdict.fit} intent={thread.verdict.intent} />
            ) : (
              <span />
            )}
            {!projectId ? null : detail?.entry ? (
              <Link
                // Over all time, since the feed's own window opens on 30 days
                // and a held thread outside it is not in the list to open.
                href={`/app/leads?${new URLSearchParams({ project: projectId, days: "all", lead: detail.entry })}`}
                scroll={false}
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-control bg-fg px-3 py-1.5 text-small text-bg"
                style={{ fontWeight: 500 }}
              >
                Open full lead
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : (
              // Always drawn, so the way in is never a thing that silently is not
              // there: a thread the sweep kept becomes a feed lead a moment later.
              <span className="flex items-center gap-2">
                <span className="text-mono text-fg-muted">{reading ? "" : "In your feed shortly"}</span>
                <span
                  aria-disabled="true"
                  className="inline-flex items-center gap-1 rounded-control bg-fg px-3 py-1.5 text-small text-bg opacity-40"
                  style={{ fontWeight: 500 }}
                >
                  Open full lead
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
              </span>
            )}
          </div>
          {body ? (
            <div className="flex flex-col gap-1">
              <HighlightedBody text={cut ? `${body}…` : body} phrase={thread.verdict?.quote ?? null} />
              {cut && reading ? <span className="text-mono text-fg-muted">Reading the rest…</span> : null}
            </div>
          ) : (
            <p className="text-small text-fg-muted">A title only, with no text of its own.</p>
          )}
          <div className="flex flex-col">
            {rows.map(([asked, answer]) => (
              <div key={asked} className="flex flex-col gap-0.5 border-b py-2 last:border-b-0">
                <span className="text-mono text-fg-muted">{asked}</span>
                <span className="text-small text-fg">{answer}</span>
              </div>
            ))}
          </div>
          {thread.url ? (
            <a
              href={thread.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-small text-fg underline"
            >
              Open on Reddit
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      <style>{`
        @keyframes shelfUp { from { transform: translateY(100%); } }
        @keyframes shelfFade { from { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { [role="dialog"] * { animation: none !important; } }
      `}</style>
    </div>
  );
}

/**
 * The wall's phone form. A wall of Reddit cards shrunk to a phone's width is
 * flicker nobody can read, and most of what goes past on it is set aside, so
 * here the sweep is the strongest leads it has kept so far, drawn as the feed
 * draws its rows. A tap opens one on a shelf.
 */
export function SweepLeads({
  leads,
  total,
  projectId,
}: {
  leads: SweepThread[];
  total: number;
  /** Absent in the recorded replay, which has no project to read the rest from. */
  projectId?: string;
}) {
  const [open, setOpen] = useState<SweepThread | null>(null);
  // Stable, or the shelf's effect runs again on every tick of the board.
  const close = useCallback(() => setOpen(null), []);
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-card border bg-surface">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-mono tracking-wide text-fg-muted uppercase">Best leads so far</span>
        <span className="text-mono tabular-nums text-fg-muted">{Math.round(total)}</span>
      </div>
      {leads.length === 0 ? (
        <p className="text-small p-3 text-fg-muted">Waiting for the first lead.</p>
      ) : (
        leads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => setOpen(thread)}
            className="transition-motion flex items-start gap-2.5 border-b py-2.5 pr-3 pl-3 text-left last:border-b-0 hover:bg-surface-2"
            style={{ animation: "sweepLand 180ms ease-out backwards" }}
          >
            <AuthorAvatar name={thread.author ?? null} size={24} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-small line-clamp-2 text-fg" style={{ fontWeight: 500 }}>
                {thread.title}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <SubredditChip name={thread.subreddit} iconUrl={null} className="min-w-0 truncate" />
                <span className="text-mono shrink-0 text-fg-muted">{shortAge(new Date(thread.createdAt))}</span>
              </span>
            </span>
            {thread.verdict ? (
              <span className="shrink-0 pt-0.5">
                <VerdictBadge fit={thread.verdict.fit} intent={thread.verdict.intent} />
              </span>
            ) : null}
          </button>
        ))
      )}
      {total > leads.length && leads.length > 0 ? (
        <p className="text-small border-t px-3 py-2.5 text-fg-muted">
          {Math.round(total - leads.length).toLocaleString()} more land in your feed when the sweep is done.
        </p>
      ) : null}
      {open ? <Shelf key={open.id} thread={open} projectId={projectId} onClose={close} /> : null}
    </section>
  );
}
