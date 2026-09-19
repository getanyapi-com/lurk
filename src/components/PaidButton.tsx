import Link from "next/link";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { relativeUntil } from "@/lib/format";
import { canPress, type Allowance } from "@/lib/throttle";

type PaidButtonProps = {
  label: string;
  allowance: Allowance;
  variant?: ComponentProps<typeof Button>["variant"];
  /** Which edge the note lines up with, matching where the button sits. */
  align?: "start" | "end";
};

/** Why the button is off, in one sentence. */
function reason({ limit, opensAt }: Allowance): string {
  if (limit === 0) {
    return "Free runs this on its daily schedule.";
  }
  const until = opensAt ? relativeUntil(opensAt) : "soon";
  const used = limit === 1 ? "This runs once a day." : `You have used today's ${limit}.`;
  return `${used} The next one opens ${until}.`;
}

/**
 * A submit button for a form whose press spends money. Once the user has used
 * their presses for the day it is off, says when the next one comes back, and
 * points at the wallet that buys more.
 */
export function PaidButton({ label, allowance, variant, align = "end" }: PaidButtonProps) {
  if (canPress(allowance)) {
    return (
      <Button type="submit" size="lg" variant={variant}>
        {label}
      </Button>
    );
  }
  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <Button type="submit" size="lg" variant={variant} disabled>
        {label}
      </Button>
      <span className="max-w-xs text-small text-fg-muted">
        {reason(allowance)}{" "}
        <Link href="/app/settings" className="underline">
          Connect a wallet
        </Link>{" "}
        for more.
      </span>
    </div>
  );
}
