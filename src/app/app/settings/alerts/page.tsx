import Link from "next/link";
import { AddChannelForm } from "@/components/alerts/AddChannelForm";
import { AlertChannelList, type ChannelRow } from "@/components/alerts/AlertChannelList";
import { EmptyState } from "@/components/EmptyState";
import { describeTarget, listChannels } from "@/lib/alerts/channels";
import { slackApp } from "@/lib/alerts/config";
import { customWebhookAllowance, customWebhookCapText } from "@/lib/alerts/select";
import { requireLocalUser } from "@/lib/auth";
import { activeProject } from "@/lib/projects";
import { tierForUser } from "@/lib/tier";

type AlertsPageProps = { searchParams: Promise<{ project?: string; slack?: string }> };

/** What the page says after Add to Slack sends the person back. */
function slackOutcome(status: string | undefined): { ok: boolean; text: string } | null {
  if (!status) {
    return null;
  }
  if (status === "connected") {
    return { ok: true, text: "Slack is connected. The next digest lands in that channel." };
  }
  const reason = status.startsWith("failed:") ? status.slice("failed:".length) : null;
  return { ok: false, text: reason ? `Slack did not connect: ${reason}` : "Slack did not connect." };
}

export default async function AlertsPage({ searchParams }: AlertsPageProps) {
  const user = await requireLocalUser();
  const { project: requested, slack } = await searchParams;
  const outcome = slackOutcome(slack);
  const project = await activeProject(user.id, requested);
  if (!project) {
    return (
      <EmptyState
        title="Alerts"
        sentence="Create a project first, then pick where its new leads should land."
      />
    );
  }
  const { limits } = await tierForUser(user.id);
  const channels = await listChannels(project.id);
  const kinds = channels.map((one) => one.channel);
  const allowance = customWebhookAllowance(kinds, limits);
  const rows: ChannelRow[] = channels.map((one) => ({
    id: one.id,
    channel: one.channel,
    describedBy: describeTarget(one.channel, one.target, one.label),
    named: one.label !== null,
    cadence: one.cadence,
    lastSentAt: one.lastSentAt ? one.lastSentAt.toISOString().slice(0, 16).replace("T", " ") : null,
  }));

  // Keyed so a half-filled channel form does not carry over to another project.
  return (
    <div key={project.id} className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          Alerts
        </h1>
        <p className="text-body text-fg-muted">
          Where new leads for {project.name} go. Email carries the whole digest; Slack, Discord and
          a plain webhook carry the top five. Without a channel, scans pause a day after your last
          visit and catch up when you come back.{" "}
          <Link href="/app/settings" className="underline">
            Back to settings
          </Link>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          Channels
        </h2>
        {customWebhookCapText(kinds, limits) ? (
          <span className="rounded-control bg-surface-2 px-2 py-0.5 text-small text-fg-muted">
            {customWebhookCapText(kinds, limits)}
          </span>
        ) : null}
      </div>
      {outcome ? (
        <p className={`text-small ${outcome.ok ? "text-fg-muted" : "text-reddit"}`}>{outcome.text}</p>
      ) : null}
      <AlertChannelList projectId={project.id} channels={rows} />
      <AddChannelForm
        projectId={project.id}
        customWebhooksAtCap={allowance.atCap}
        hourlyAllowed={limits?.alertCadence !== "daily"}
        slackInstall={slackApp() !== null}
      />
    </div>
  );
}
