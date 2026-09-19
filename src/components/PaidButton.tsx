import Link from "next/link";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { relativeUntil } from "@/lib/format";
import type { Allowance } from "@/lib/throttle";

type PaidButtonProps = {
  label: string;
  allowance: Allowance;
  variant?: ComponentProps<typeof Button>["variant"];
  /** Which edge the note lines up with, matching where the button sits. */
  align?: "start" | "end";
};

/** Why the button is off, in one sentence. */
function reason({ limit, window, opensAt }: Allowance): string {
  if (limit === 0) {
    return "Free runs this on its schedule.";
  }
  if (window === "ever") {
    return "Free includes this once, and it has been used.";
  }
  const until = opensAt ? relativeUntil(opensAt) : "soon";
  return `You have used today's ${limit}. The next one opens ${until}.`;
}

/**
 * A submit button for a form whose press spends money. Once the user has no
 * press left it is off and says why: on free, that the one press is used and a
 * wallet buys more; on a wallet, when tomorrow's press comes back.
 */
export function PaidButton({ label, allowance, variant, align = "end" }: PaidButtonProps) {
  if (!allowance.spent) {
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
        {reason(allowance)}
        {allowance.window === "ever" ? (
          <>
            {" "}
            <Link href="/app/settings" className="underline">
              Connect a wallet
            </Link>{" "}
            for more.
          </>
        ) : null}
      </span>
    </div>
  );
}
