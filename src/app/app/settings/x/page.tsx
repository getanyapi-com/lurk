import Link from "next/link";
import { notFound } from "next/navigation";
import { setXAlertsAction } from "@/app/app/settings/x/actions";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { WalletPanel } from "@/components/WalletPanel";
import { Button } from "@/components/ui/button";
import { listChannels } from "@/lib/alerts/channels";
import { walletConnection } from "@/lib/anyapi";
import { requireLocalUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { relativeAge } from "@/lib/format";
import { requireActiveProject } from "@/lib/projects";
import { xEnabledFor } from "@/lib/x/enabled";
import { listXLanes, projectedWalletCostPerDay, xSettingsOf } from "@/lib/x/read";

type XSettingsPageProps = { searchParams: Promise<{ project?: string }> };

/** Dollars the way a cost line says them: small sums to the tenth of a cent. */
function usd(amount: number): string {
  if (amount === 0) return "$0";
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

/**
 * Settings' X tab, for one project: how often X is checked on each plan and
 * what it costs, whether the project's alert channels carry its X asks, and
 * what X has cost it. X starts when the X tab is first opened, never here.
 */
export default async function XSettingsPage({ searchParams }: XSettingsPageProps) {
  const user = await requireLocalUser();
  if (!xEnabledFor(user.id)) {
    notFound();
  }
  const { project: requested } = await searchParams;
  const project = await requireActiveProject(user.id, requested);
  const [view, channels, lanes, connection] = await Promise.all([
    xSettingsOf(project.id),
    listChannels(project.id),
    listXLanes(project.id),
    walletConnection(user.id),
  ]);
  const selfHosted = config().SELF_HOSTED;
  // A connected wallet is what puts a user on the connected tier.
  const paid = connection !== null || selfHosted;
  const active = lanes.filter((lane) => lane.state === "active");
  // The wallet's figure from this project's own search rates, once it has searches to measure.
  const walletCost =
    active.length > 0
      ? `about ${usd(projectedWalletCostPerDay(active))} a day for ${project.name}`
      : undefined;
  const query = `?project=${encodeURIComponent(project.id)}`;
  const payer = selfHosted
    ? "Your own keys paid for all of it."
    : paid
      ? "X data came from your wallet; lurk paid for the model."
      : "lurk paid for all of it.";

  return (
    <div key={project.id} className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-h2" style={{ fontWeight: 500 }}>
        Settings
      </h1>
      <SettingsTabs active="x" showX project={project.id} />
      <p className="text-body text-fg-muted">
        lurk searches X for people asking for what {project.name} does, leaving the products you compete with, or
        building their own. The searches are written from your{" "}
        <Link href={`/app/product${query}`} className="underline">
          Product page
        </Link>
        , the same one Reddit uses. X starts for a project the first time you open{" "}
        <Link href={`/app/x${query}`} className="underline">
          X leads
        </Link>
        , and keeps checking while you open it at least once a week, or while its asks go to an alert channel.
      </p>

      <WalletPanel connectedAt={connection?.connectedAt ?? null} selfHosted={selfHosted} scope="x" xWalletCost={walletCost} />

      <section className="flex flex-col gap-3 rounded-card border bg-surface p-5">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          Alerts
        </h2>
        {!view.started ? (
          <p className="text-small text-fg-muted">
            X has not started for {project.name} yet. Once it has, its asks go to the same channels as its Reddit leads.
          </p>
        ) : (
          <>
            <p className="text-small text-fg-muted">
              {view.alerts
                ? `X asks go to ${project.name}'s alert channels with its Reddit leads.`
                : `X asks stay in the X leads tab and are not sent to ${project.name}'s alert channels.`}{" "}
              {channels.length === 0 ? (
                <>
                  This project has no alert channels yet.{" "}
                  <Link href={`/app/settings/alerts${query}`} className="underline">
                    Add one
                  </Link>
                </>
              ) : (
                <Link href={`/app/settings/alerts${query}`} className="underline">
                  {channels.length === 1 ? "1 channel" : `${channels.length} channels`}
                </Link>
              )}
            </p>
            {view.alerts ? (
              <p className="text-small text-fg-muted">
                While they do, and the project has a channel, X keeps checking even in weeks you do not open the tab.
              </p>
            ) : null}
            <form action={setXAlertsAction.bind(null, project.id, !view.alerts)}>
              <Button type="submit" variant="outline">
                {view.alerts ? "Stop sending X asks" : "Send X asks to alerts"}
              </Button>
            </form>
          </>
        )}
      </section>

      <section className="flex flex-col gap-1 rounded-card border bg-surface p-5">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          What X has cost
        </h2>
        <p className="text-small text-fg-muted">
          {view.started
            ? `${usd(view.spentToday)} today and ${usd(view.spentMonth)} over the last 30 days for ${project.name}, searches and model together. ${payer}${view.lastScanAt ? ` Last checked ${relativeAge(view.lastScanAt)}.` : ""}`
            : `Nothing yet. The first look at the last 30 days usually costs a cent or two, and never more than about $0.09.`}
        </p>
      </section>
    </div>
  );
}
