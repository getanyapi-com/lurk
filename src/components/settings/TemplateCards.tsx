import Link from "next/link";
import { Lock, Pencil } from "lucide-react";
import { PRESETS } from "@/lib/settings";
import type { ScanSettings, SettingsPreset } from "@/lib/settings/types";
import { cn } from "@/lib/utils";

type TemplateCardsProps = { preset: SettingsPreset };

function cadenceText(settings: ScanSettings): string {
  const { cadence } = settings;
  if (cadence.kind === "daily") {
    return `Once a day at ${String(cadence.hour).padStart(2, "0")}:00 ${cadence.timezone}`;
  }
  return cadence.hours === 1 ? "Every hour" : `Every ${cadence.hours} hours`;
}

/** The template's values as a person would read them across the top of the page. */
function rowsFor(settings: ScanSettings): [string, string][] {
  const { threads } = settings;
  return [
    ["Cadence", cadenceText(settings)],
    ["Reply window", `${threads.replyWindowDays} days`],
    ["Minimum replies", String(threads.minReplies)],
    ["Threads per scan", threads.threadsPerScan === null ? "No cap" : String(threads.threadsPerScan)],
    ["Older lead threads", threads.readOldThreadsOnce ? "Read once" : "Skipped"],
    ["Google-ranked threads", threads.readSeoReplies ? "Replies read" : "Skipped"],
  ];
}

function TemplateCard({
  title,
  note,
  settings,
  current,
  editable,
}: {
  title: string;
  note: string;
  settings: ScanSettings;
  current: boolean;
  editable: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-card border p-5",
        current ? "border-primary bg-surface-2" : "bg-surface",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-h3 text-fg" style={{ fontWeight: 500 }}>
          {title}
        </span>
        {current ? (
          <span className="rounded-control bg-primary px-2 py-0.5 text-small text-primary-fg">
            Your template
          </span>
        ) : null}
      </div>
      <span className="flex items-center gap-1.5 text-small text-fg-muted">
        {editable ? (
          <Pencil className="size-3.5" aria-hidden="true" />
        ) : (
          <Lock className="size-3.5" aria-hidden="true" />
        )}
        {note}
      </span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
        {rowsFor(settings).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The free template and the paid one side by side, so the locked values on
 * the form below read as a plan, not a bug. Self-host is the paid template
 * with no wallet to connect.
 */
export function TemplateCards({ preset }: TemplateCardsProps) {
  const paid = preset !== "free";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-2">
        <TemplateCard
          title="Free"
          note="Only the daily scan hour and timezone can be changed."
          settings={PRESETS.free}
          current={!paid}
          editable={false}
        />
        <TemplateCard
          title={preset === "selfHost" ? "Self-hosted" : "Connected wallet"}
          note="Every value below is yours to change."
          settings={PRESETS[preset === "selfHost" ? "selfHost" : "connected"]}
          current={paid}
          editable
        />
      </div>
      {paid ? null : (
        <p className="text-small text-fg-muted">
          Connect an AnyAPI wallet to move to the paid template.{" "}
          <Link href="/app/settings" className="underline">
            Connect a wallet
          </Link>
        </p>
      )}
    </div>
  );
}
