"use client";

import { useState } from "react";
import { Check, ExternalLink, EyeOff, ThumbsDown } from "lucide-react";
import { hideXLeadAction, notFitXLeadAction, repliedXLeadAction } from "@/app/app/x/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const NOT_FIT_REASONS = {
  ask: ["wrong audience", "seller side", "no active need", "wrong category", "other"],
  // "No active need" is true of every reply by construction.
  reply: ["can't help them", "not worth replying", "seller side", "other"],
};

type XLeadActionsProps = { projectId: string; leadId: string | null; url: string; kind?: "ask" | "reply" };

/**
 * The foot of the X detail pane, as LeadActions is for Reddit: replying on X is
 * the one thing the page leads to, so it is the only filled button. Replied
 * records that the user answered it, and the rest take the lead out of the tab
 * or record why it was wrong. A held post has no lead to hide, so it gets only
 * the link.
 */
export function XLeadActions({ projectId, leadId, url, kind = "ask" }: XLeadActionsProps) {
  const [picking, setPicking] = useState(false);
  const iconClass = "size-3.5 text-fg-muted";
  return (
    <div className="flex shrink-0 flex-col gap-3 border-t p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          nativeButton={false}
          render={
            <a href={url} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open on X
            </a>
          }
        />
        {leadId ? (
          <>
            <form action={repliedXLeadAction.bind(null, projectId, leadId)}>
              <Button type="submit" variant="ghost" size="sm">
                <Check className={iconClass} aria-hidden="true" />
                Replied
              </Button>
            </form>
            <form action={hideXLeadAction.bind(null, projectId, leadId)}>
              <Button type="submit" variant="ghost" size="sm">
                <EyeOff className={iconClass} aria-hidden="true" />
                Hide
              </Button>
            </form>
            {picking ? (
              <form action={notFitXLeadAction.bind(null, projectId, leadId)} className="flex items-center gap-1.5">
                <Select
                  name="reason"
                  required
                  ariaLabel="Why this lead is not a fit"
                  placeholder="Pick a reason"
                  className="h-7"
                  options={NOT_FIT_REASONS[kind].map((reason) => ({ value: reason, label: reason }))}
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
          </>
        ) : null}
      </div>
    </div>
  );
}
