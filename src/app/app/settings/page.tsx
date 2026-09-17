import { Bell, Clock, Gauge, KeyRound } from "lucide-react";
import { SettingsLinkCard } from "@/components/SettingsLinkCard";
import { WalletPanel } from "@/components/WalletPanel";
import { requireLocalUser } from "@/lib/auth";
import { walletConnection } from "@/lib/anyapi";

export default async function SettingsPage() {
  const user = await requireLocalUser();
  const connection = await walletConnection(user.id);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-h2" style={{ fontWeight: 500 }}>
        Settings
      </h1>
      <WalletPanel connectedAt={connection?.connectedAt ?? null} />
      <SettingsLinkCard
        href="/app/settings/alerts"
        icon={Bell}
        title="Alerts"
        sentence="Where new leads land: a daily email digest, Slack, Discord or your own webhook."
      />
      <SettingsLinkCard
        href="/app/settings/scanning"
        icon={Clock}
        title="Scanning"
        sentence="How often each project is scanned, and which threads a scan opens."
      />
      <SettingsLinkCard
        href="/app/settings/scoring"
        icon={Gauge}
        title="Scoring"
        sentence="What the scorer decided, what you did with it, and what each model call cost."
      />
      <SettingsLinkCard
        href="/app/settings/api"
        icon={KeyRound}
        title="API and MCP"
        sentence="Read your projects, leads and spend from a script or an agent."
      />
    </div>
  );
}
