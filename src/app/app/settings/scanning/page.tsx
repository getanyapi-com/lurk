import Link from "next/link";
import { ScanSettingsForm } from "@/components/settings/ScanSettingsForm";
import { requireLocalUser } from "@/lib/auth";
import { settingsForUser } from "@/lib/settings";
import type { SettingsPreset } from "@/lib/settings/types";

/** What each preset is called in the words a person here would use for it. */
const PRESET_NAMES: Record<SettingsPreset, string> = {
  free: "free wallet",
  connected: "your wallet",
  selfHost: "self-hosted",
};

/**
 * Every value that decides when a scan runs and what it buys from a thread,
 * with the ones this tier allows editable and the rest shown as they stand.
 */
export default async function ScanningSettingsPage() {
  const user = await requireLocalUser();
  const resolved = await settingsForUser(user.id);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          Scanning
        </h1>
        <p className="text-body text-fg-muted">
          How often lurk looks for new leads, and which threads it pays to read the replies of.{" "}
          <Link href="/app/settings" className="underline">
            Back to settings
          </Link>
        </p>
      </div>
      <p className="text-small text-fg-muted">
        You are on{" "}
        <span className="rounded-control bg-surface-2 px-2 py-0.5 text-small text-fg">
          {PRESET_NAMES[resolved.preset]}
        </span>
      </p>
      <ScanSettingsForm
        settings={resolved.settings}
        editable={[...resolved.editable]}
        timezoneChosen={resolved.chosen.timezone}
      />
    </div>
  );
}
