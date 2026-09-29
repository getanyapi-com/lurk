import { ScanSettingsForm } from "@/components/settings/ScanSettingsForm";
import { WalletPanel } from "@/components/WalletPanel";
import { walletConnection } from "@/lib/anyapi";
import { requireLocalUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { settingsForUser } from "@/lib/settings";
import { xEnabledFor } from "@/lib/x/enabled";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

type ScanningSettingsPageProps = { searchParams: Promise<{ project?: string }> };

/**
 * Settings' Reddit tab: every value that decides when a scan runs and what it
 * buys from a thread, with the ones this tier allows editable and the rest
 * shown as they stand.
 */
export default async function ScanningSettingsPage({ searchParams }: ScanningSettingsPageProps) {
  const user = await requireLocalUser();
  const { project } = await searchParams;
  const [resolved, connection] = await Promise.all([settingsForUser(user.id), walletConnection(user.id)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-h2" style={{ fontWeight: 500 }}>
        Settings
      </h1>
      <SettingsTabs active="reddit" showX={xEnabledFor(user.id)} project={project} />
      <p className="text-body text-fg-muted">
        How often lurk looks on Reddit for new leads, and which threads it pays to read the replies of, for all your
        projects. With a wallet, Reddit data is billed to your AnyAPI balance; lurk still pays for the model.
      </p>
      <WalletPanel connectedAt={connection?.connectedAt ?? null} selfHosted={config().SELF_HOSTED} scope="reddit" />
      <ScanSettingsForm
        settings={resolved.settings}
        editable={[...resolved.editable]}
        timezoneChosen={resolved.chosen.timezone}
      />
    </div>
  );
}
