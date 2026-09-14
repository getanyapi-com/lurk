"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, EyeOff, PenLine, ThumbsDown } from "lucide-react";
import { hideLeadAction, markNotFitAction } from "@/app/app/leads/actions";
import { DraftPanel } from "@/components/drafts/DraftPanel";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const NOT_FIT_REASONS = [
  "wrong audience",
  "seller side",
  "no active need",
  "wrong category",
  "other",
];

type LeadActionsProps = {
  projectId: string;
  leadId: string;
  url: string;
  title: string;
  subreddit: string;
  promoPolicy: string | null;
};

/**
 * The foot of the detail pane. Writing the reply is the one thing this page is
 * for, so it is the only filled button; opening the thread and taking the lead
 * out of the feed sit beside it. The draft opens underneath, where it is read.
 */
export function LeadActions({
  projectId,
  leadId,
  url,
  title,
  subreddit,
  promoPolicy,
}: LeadActionsProps) {
  const [open, setOpen] = useState(false);
  const [draftRequests, setDraftRequests] = useState(0);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const draftRef = useRef<HTMLDivElement>(null);
  const iconClass = "size-3.5 text-fg-muted";

  useEffect(() => {
    if (draftRequests > 0) {
      draftRef.current?.querySelector("textarea")?.focus();
    }
  }, [draftRequests]);

  function draftReply() {
    setOpen(true);
    setDraftRequests((count) => count + 1);
  }

  async function copyTitle() {
    await navigator.clipboard.writeText(title);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex shrink-0 flex-col gap-3 border-t p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={draftReply}>
          <PenLine className="size-3.5" aria-hidden="true" />
          Draft a reply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={
            <a href={url} target="_blank" rel="noreferrer noopener">
              <ExternalLink className={iconClass} aria-hidden="true" />
              Open on Reddit
            </a>
          }
        />
        <form action={hideLeadAction.bind(null, projectId, leadId)}>
          <Button type="submit" variant="ghost" size="sm">
            <EyeOff className={iconClass} aria-hidden="true" />
            Hide
          </Button>
        </form>
        {picking ? (
          <form
            action={markNotFitAction.bind(null, projectId, leadId)}
            className="flex items-center gap-1.5"
          >
            <Select
              name="reason"
              required
              ariaLabel="Why this lead is not a fit"
              placeholder="Pick a reason"
              className="h-7"
              options={NOT_FIT_REASONS.map((reason) => ({ value: reason, label: reason }))}
            />
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </form>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
            <ThumbsDown className={iconClass} aria-hidden="true" />
            Not a fit
          </Button>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={copyTitle}>
          {copied ? (
            <Check className={iconClass} aria-hidden="true" />
          ) : (
            <Copy className={iconClass} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy title"}
        </Button>
      </div>
      {open ? (
        <div ref={draftRef}>
          <DraftPanel
            projectId={projectId}
            leadId={leadId}
            subreddit={subreddit}
            promoPolicy={promoPolicy}
          />
        </div>
      ) : null}
    </div>
  );
}
