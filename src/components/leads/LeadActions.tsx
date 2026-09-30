"use client";

import { useState } from "react";
import { BellOff, Check, ExternalLink, EyeOff, RotateCcw, ThumbsDown } from "lucide-react";
import {
  hideLeadAction,
  markNotFitAction,
  muteSubredditAction,
  reopenLeadAction,
  repliedLeadAction,
} from "@/app/app/leads/actions";
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
  subreddit: string;
  /** The thread is already marked replied, so the button takes that back instead. */
  replied: boolean;
};

/**
 * The foot of the detail pane. Reading the thread on Reddit is the one thing
 * this page leads to, so it is the only filled button; the rest take the lead
 * out of the feed or record why it was wrong. Replied covers the whole thread,
 * and mute the whole community, in the feed and every alert channel alike.
 */
export function LeadActions({ projectId, leadId, url, subreddit, replied }: LeadActionsProps) {
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
              Open on Reddit
            </a>
          }
        />
        {replied ? (
          <form action={reopenLeadAction.bind(null, projectId, leadId)}>
            <Button type="submit" variant="ghost" size="sm">
              <RotateCcw className={iconClass} aria-hidden="true" />
              Not replied
            </Button>
          </form>
        ) : (
          <form action={repliedLeadAction.bind(null, projectId, leadId)}>
            <Button type="submit" variant="ghost" size="sm">
              <Check className={iconClass} aria-hidden="true" />
              Replied
            </Button>
          </form>
        )}
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
        <form action={muteSubredditAction.bind(null, projectId, subreddit)}>
          <Button type="submit" variant="ghost" size="sm">
            <BellOff className={iconClass} aria-hidden="true" />
            Mute r/{subreddit}
          </Button>
        </form>
      </div>
    </div>
  );
}
