"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import posthog from "posthog-js";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** When this tab last reloaded itself, so a page that keeps failing is not reloaded forever. */
const RELOADED_AT = "lurk:stale-action-reload";

/**
 * Anything an app page throws. The usual cause is a tab left open across a
 * deploy calling a Server Action the new server no longer has; that one is
 * fixed by loading the page again, so it is done without asking.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const stale = unstable_isUnrecognizedActionError(error);

  useEffect(() => {
    if (stale) {
      const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(RELOADED_AT, String(Date.now()));
        window.location.reload();
        return;
      }
    }
    if (posthog.__loaded) {
      posthog.captureException(error, { digest: error.digest });
    }
  }, [error, stale]);

  return (
    <div className="flex max-w-2xl flex-col gap-4 rounded-card border bg-surface p-8">
      <h2 className="text-h3" style={{ fontWeight: 500 }}>
        {stale ? "lurk was updated" : "Something went wrong"}
      </h2>
      <p className="text-body text-fg-muted">
        {stale
          ? "This page is from the version before. Load it again to carry on."
          : "That did not go through. Try again, or load the page again if it keeps failing."}
      </p>
      <div className="flex gap-2">
        {stale ? null : (
          <Button variant="outline" size="lg" onClick={() => retry()}>
            Try again
          </Button>
        )}
        <Button size="lg" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
