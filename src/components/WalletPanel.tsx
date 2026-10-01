import Link from "next/link";
import { Check } from "lucide-react";
import { AnyapiLink } from "@/components/AnyapiLink";
import { AnyapiMark } from "@/components/AnyapiMark";
import { Button } from "@/components/ui/button";
import { disconnectWalletAction } from "@/app/app/settings/actions";
import { TIERS, type TierName } from "@/lib/tiers";
import { cn } from "@/lib/utils";

/** Which settings tab the panel sits on: each lists only its own limits. */
export type PlanScope = "general" | "reddit" | "x";

type WalletPanelProps = {
  connectedAt: Date | null;
  selfHosted: boolean;
  scope?: PlanScope;
  /** On the X tab, what X data would cost this project from a wallet, e.g. "about $0.02 a day for Clipy". */
  xWalletCost?: string;
};

/** Always names what is counted, so a row reads "Unlimited projects", never "Unlimited". */
function unlimited(value: number | null, unit: string): string {
  return `${value === null ? "Unlimited" : value.toLocaleString()} ${unit}`;
}

/** One line per limit, in the words a person compares plans by. */
function rowsFor(name: TierName, scope: PlanScope, xWalletCost?: string): string[] {
  const t = TIERS[name];
  const free = name === "free";
  if (scope === "reddit") {
    return [
      free ? "Scans once a day, at an hour you pick" : "Scans every hour",
      unlimited(t.keywordsPerProject, "keywords per project"),
      unlimited(t.subredditsPerProject, "subreddits per project"),
      free ? "Reads replies on the 20 best fresh threads a scan" : "Reads every thread a scan can use",
      free ? "Skips older lead threads" : "Reads older lead threads once",
      free ? "lurk pays for every scan" : "About $0.03 for a first scan of 12 keywords",
    ];
  }
  if (scope === "x") {
    const x = t.x;
    const scanNow = t.actions.presses.x_scan_now;
    return [
      free ? "Checks X once a day" : `Checks X every hour, quiet searches every ${x.maxBackoffHours} hours`,
      "Every search lurk writes for a project",
      free ? "Reads the newest page of each search" : "Reads two pages of each search",
      scanNow === 0 ? "No Scan now" : `Scan now ${scanNow} times a day`,
      "A first look at the last 30 days",
      free ? "lurk pays for every search" : `X data ${xWalletCost ?? "about $0.02 to $0.04 a day a project"}`,
    ];
  }
  return [
    unlimited(t.projects, t.projects === 1 ? "project" : "projects"),
    unlimited(t.competitors, "competitors"),
    unlimited(t.customWebhooks, t.customWebhooks === 1 ? "custom webhook" : "custom webhooks"),
    t.alertCadence === "daily" ? "Alerts once a day" : "Alerts every hour",
    `Reddit SEO refreshed ${t.seoRefreshDays === 1 ? "daily" : `every ${t.seoRefreshDays} days`}`,
    unlimited(t.apiRequestsPerDay, "API requests a day"),
  ];
}

function TierColumn({
  title,
  price,
  current,
  rows,
}: {
  title: string;
  price: string;
  current: boolean;
  rows: string[];
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
          <span className="rounded-control bg-primary px-2 py-0.5 text-small text-primary-fg">Your plan</span>
        ) : null}
      </div>
      <span className="text-body text-fg-muted">{price}</span>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row} className="flex items-start gap-2 text-body text-fg">
            <Check className="mt-1 size-4 shrink-0 text-fg-muted" aria-hidden="true" />
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The two plans side by side, which one this person is on, and how to switch.
 * Each settings tab draws it with its own limits; only General disconnects.
 */
export function WalletPanel({ connectedAt, selfHosted, scope = "general", xWalletCost }: WalletPanelProps) {
  const connected = connectedAt !== null;
  return (
    <section className="flex flex-col gap-5 rounded-card border bg-surface p-6">
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-card border bg-bg">
          <AnyapiMark size={36} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-h3" style={{ fontWeight: 500 }}>
            Your plan
          </h2>
          <p className="text-body text-fg-muted">
            {selfHosted
              ? "This instance is self-hosted, so every limit below is off."
              : connected
                ? `AnyAPI wallet connected on ${connectedAt.toISOString().slice(0, 10)}. Scans bill your wallet per request, up to the spend cap you set when you authorized lurk.`
                : "Free runs on a shared wallet with daily scans. Connect your own AnyAPI wallet and every scan is billed per request to your account, with the limits below lifted."}
          </p>
          <AnyapiLink mark={false} className="self-start text-small text-fg-muted hover:text-fg">
            Open your AnyAPI dashboard
          </AnyapiLink>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TierColumn title="Free" price="$0, shared wallet" current={!connected} rows={rowsFor("free", scope)} />
        <TierColumn
          title="Connected wallet"
          price="Pay per request from your AnyAPI wallet"
          current={connected}
          rows={rowsFor("connected", scope, xWalletCost)}
        />
      </div>

      {connected && scope !== "general" ? null : connected ? (
        <form action={disconnectWalletAction} className="self-start">
          <Button type="submit" variant="outline" size="lg">
            Disconnect wallet
          </Button>
        </form>
      ) : (
        <Button
          size="lg"
          nativeButton={false}
          className="self-start"
          render={
            <Link href="/connect" className="flex items-center gap-2">
              <AnyapiMark size={16} />
              Connect AnyAPI wallet
            </Link>
          }
        />
      )}
    </section>
  );
}
