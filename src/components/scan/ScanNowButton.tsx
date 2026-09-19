import Link from "next/link";
import { Button } from "@/components/ui/button";

type ScanNowButtonProps = {
  /** Whether this tier may scan on demand. */
  allowed: boolean;
  /** Which edge the note lines up with, matching where the button sits. */
  align?: "start" | "end";
};

/**
 * The Scan now button, for a form to wrap. On free it is off and says why:
 * free scans once a day on its schedule, and a wallet is what buys more.
 */
export function ScanNowButton({ allowed, align = "end" }: ScanNowButtonProps) {
  if (allowed) {
    return (
      <Button type="submit" size="lg">
        Scan now
      </Button>
    );
  }
  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <Button type="submit" size="lg" disabled>
        Scan now
      </Button>
      <span className="text-small text-fg-muted">
        Free scans once a day.{" "}
        <Link href="/app/settings" className="underline">
          Connect a wallet
        </Link>{" "}
        to scan on demand.
      </span>
    </div>
  );
}
