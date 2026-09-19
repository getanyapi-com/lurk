import Link from "next/link";
import { Button } from "@/components/ui/button";
import { relativeUntil } from "@/lib/format";

type ScanNowButtonProps = {
  /** When the next press is allowed, or null when it is allowed now. */
  opensAt: Date | null;
  /** Which edge the note lines up with, matching where the button sits. */
  align?: "start" | "end";
};

/**
 * The Scan now button, for a form to wrap. Once a free project has used its
 * press for the day, the button is off and says when it comes back.
 */
export function ScanNowButton({ opensAt, align = "end" }: ScanNowButtonProps) {
  if (!opensAt) {
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
        Free scans on demand once a day. Next {relativeUntil(opensAt)}, or{" "}
        <Link href="/app/settings" className="underline">
          connect a wallet
        </Link>
        .
      </span>
    </div>
  );
}
