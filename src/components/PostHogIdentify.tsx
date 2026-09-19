"use client";

import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

// Ties a signed-in visitor's PostHog person to their lurk account, and lets go of
// it on sign-out.
export function PostHogIdentify() {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    // Not initialized off the lurk.so host (see src/instrumentation-client.ts).
    if (!isLoaded || !posthog.__loaded) return;
    if (user) {
      posthog.identify(user.id, {
        name: user.fullName ?? undefined,
        email: user.primaryEmailAddress?.emailAddress,
      });
    } else if (posthog._isIdentified()) {
      posthog.reset();
    }
  }, [isLoaded, user]);

  return null;
}
