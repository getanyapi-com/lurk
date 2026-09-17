"use client";

import { useState, useTransition } from "react";
import { Mail, MessageCircle, Send, Slack, Trash2, Webhook } from "lucide-react";
import { removeChannelAction, sendTestAction } from "@/app/app/settings/alerts/actions";
import { Button } from "@/components/ui/button";
import { CHANNEL_LABELS, type AlertCadence, type AlertChannel } from "@/lib/alerts/types";

export type ChannelRow = {
  id: string;
  channel: AlertChannel;
  /** What to call it: its label, its address, or a webhook URL without its secret. */
  describedBy: string;
  /** True when `describedBy` is a name rather than an address, so it reads as prose. */
  named: boolean;
  cadence: AlertCadence;
  lastSentAt: string | null;
};

type AlertChannelListProps = { projectId: string; channels: ChannelRow[] };

const ICONS = {
  email: Mail,
  slack: Slack,
  discord: MessageCircle,
  webhook: Webhook,
} as const;

/** Every channel on the project, with a test send and a way to take it off. */
export function AlertChannelList({ projectId, channels }: AlertChannelListProps) {
  const [result, setResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function test(id: string) {
    startTransition(async () => {
      const outcome = await sendTestAction(projectId, id);
      setResult({ id, ...outcome });
    });
  }

  if (channels.length === 0) {
    return (
      <p className="text-body text-fg-muted">
        No channels yet. Add one and every scan that finds something will tell you.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {channels.map((row) => {
        const Icon = ICONS[row.channel];
        const said = result?.id === row.id ? result : null;
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded-card border bg-surface px-4 py-3"
          >
            <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
            <span className="text-body text-fg">{CHANNEL_LABELS[row.channel]}</span>
            <span
              className={`min-w-0 flex-1 truncate text-fg-muted ${row.named ? "text-body" : "font-mono text-mono"}`}
            >
              {row.describedBy}
            </span>
            <span className="rounded-control bg-surface-2 px-2 py-0.5 text-small text-fg-muted">
              {row.cadence}
            </span>
            <span className="text-small text-fg-muted">
              {row.lastSentAt ? `Last sent ${row.lastSentAt}` : "Never sent"}
            </span>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => test(row.id)}>
              <Send className="size-3.5" aria-hidden="true" />
              Send test
            </Button>
            <form action={removeChannelAction.bind(null, projectId, row.id)}>
              <Button type="submit" variant="ghost" size="sm" aria-label="Remove channel">
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </form>
            {said ? (
              <p className={`w-full text-small ${said.ok ? "text-fg-muted" : "text-reddit"}`}>
                {said.message}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
