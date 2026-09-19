import { Clock, KeyRound } from "lucide-react";
import { SettingsLinkCard } from "@/components/SettingsLinkCard";
import { WalletPanel } from "@/components/WalletPanel";
import { requireLocalUser } from "@/lib/auth";
import { walletConnection } from "@/lib/anyapi";
import { config } from "@/lib/config";

type SettingsPageProps = { searchParams: Promise<{ project?: string }> };

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireLocalUser();
  // Carried through so the rail on the next screen still names your project.
  const { project } = await searchParams;
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  const connection = await walletConnection(user.id);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-h2" style={{ fontWeight: 500 }}>
        Settings
      </h1>
      <WalletPanel
        connectedAt={connection?.connectedAt ?? null}
        selfHosted={config().SELF_HOSTED}
      />
      <SettingsLinkCard
        href={`/app/settings/scanning${query}`}
        icon={Clock}
        title="Scanning"
        sentence="How often each project is scanned, and which threads a scan opens."
      />
      <SettingsLinkCard
        href={`/app/settings/api${query}`}
        icon={KeyRound}
        title="API and MCP"
        sentence="Read your projects, leads and spend from a script or an agent."
      />
    </div>
  );
}
