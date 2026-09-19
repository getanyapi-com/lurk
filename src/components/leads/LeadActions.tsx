"use client";

import { useState } from "react";
import { ExternalLink, EyeOff, ThumbsDown } from "lucide-react";
import { hideLeadAction, markNotFitAction } from "@/app/app/leads/actions";
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
};

/**
 * The foot of the detail pane. Reading the thread on Reddit is the one thing
 * this page leads to, so it is the only filled button; the rest take the lead
 * out of the feed or record why it was wrong.
 */
export function LeadActions({ projectId, leadId, url }: LeadActionsProps) {
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
      </div>
    </div>
  );
}
