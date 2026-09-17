"use client";

import { useState } from "react";
import { Plus, Slack } from "lucide-react";
import { addChannelAction } from "@/app/app/settings/alerts/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ALERT_CHANNELS, CHANNEL_LABELS, type AlertCadence, type AlertChannel } from "@/lib/alerts/types";
import { cn } from "@/lib/utils";

type AddChannelFormProps = {
  projectId: string;
  /** Channels whose webhook allowance is already used up. */
  webhooksAtCap: boolean;
  hourlyAllowed: boolean;
  /** True when this instance has a Slack app, so a channel can be picked instead of pasted. */
  slackInstall: boolean;
};

const PLACEHOLDERS: Record<AlertChannel, string> = {
  email: "you@company.com",
  slack: "https://hooks.slack.com/services/...",
  discord: "https://discord.com/api/webhooks/...",
  webhook: "https://example.com/hooks/leads",
};

const FIELD =
  "h-10 rounded-control border bg-surface px-3 text-body text-fg";

/** Type, address and cadence for one new alert channel. */
export function AddChannelForm({
  projectId,
  webhooksAtCap,
  hourlyAllowed,
  slackInstall,
}: AddChannelFormProps) {
  const [channel, setChannel] = useState<AlertChannel>("email");
  const [cadence, setCadence] = useState<AlertCadence>("daily");
  const [pasteSlack, setPasteSlack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = webhooksAtCap && channel !== "email";
  const pickSlack = channel === "slack" && slackInstall && !pasteSlack;
  const installHref = `/connect/slack?${new URLSearchParams({ project: projectId, cadence })}`;

  async function submit(formData: FormData) {
    setError(null);
    try {
      await addChannelAction(projectId, formData);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-3 rounded-card border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          name="channel"
          ariaLabel="Channel type"
          className="h-10 px-3 text-body"
          value={channel}
          onValueChange={(value) => setChannel(value as AlertChannel)}
          options={ALERT_CHANNELS.map((one) => ({ value: one, label: CHANNEL_LABELS[one] }))}
        />
        {pickSlack ? (
          <span className="min-w-64 flex-1 text-body text-fg-muted">
            Pick the channel on Slack&apos;s side.
          </span>
        ) : (
          <input
            name="target"
            required
            placeholder={PLACEHOLDERS[channel]}
            aria-label="Where to send it"
            className={`${FIELD} min-w-64 flex-1`}
          />
        )}
        <Select
          name="cadence"
          ariaLabel="How often"
          className="h-10 px-3 text-body"
          value={cadence}
          onValueChange={(value) => setCadence(value === "hourly" ? "hourly" : "daily")}
          options={[
            { value: "daily", label: "Daily" },
            {
              value: "hourly",
              label: hourlyAllowed ? "Hourly" : "Hourly (connect a wallet)",
              disabled: !hourlyAllowed,
            },
          ]}
        />
        {pickSlack ? (
          <a
            href={blocked ? undefined : installHref}
            aria-disabled={blocked}
            className={cn(buttonVariants({ size: "lg" }), blocked && "pointer-events-none opacity-50")}
          >
            <Slack className="size-4" aria-hidden="true" />
            Add to Slack
          </a>
        ) : (
          <Button type="submit" size="lg" disabled={blocked}>
            <Plus className="size-4" aria-hidden="true" />
            Add channel
          </Button>
        )}
      </div>
      {channel === "slack" && slackInstall ? (
        <button
          type="button"
          className="self-start text-small text-fg-muted underline"
          onClick={() => setPasteSlack((current) => !current)}
        >
          {pasteSlack ? "Pick a channel on Slack instead" : "Paste a webhook URL instead"}
        </button>
      ) : null}
      {blocked ? (
        <p className="text-small text-fg-muted">
          This tier allows one webhook. Connect a wallet to add more.
        </p>
      ) : null}
      {error ? <p className="text-small text-reddit">{error}</p> : null}
    </form>
  );
}
