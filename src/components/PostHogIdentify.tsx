"use client";

import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

// Ties a signed-in visitor's PostHog person to their lurk account, and lets go of
// it on sign-out.
//
// The email goes in `lurk_email`, not `email`. The project is shared with AnyAPI,
// whose dashboard joins PostHog people to customers by Clerk id and then by
// `email`. lurk runs its own Clerk instance, so the id never matches; an `email`
// match would pour a lurk user's referrers into their AnyAPI customer's Source.
export function PostHogIdentify() {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    // Not initialized off the lurk.so host (see src/instrumentation-client.ts).
    if (!isLoaded || !posthog.__loaded) return;
    if (user) {
      posthog.identify(user.id, {
        name: user.fullName ?? undefined,
        lurk_email: user.primaryEmailAddress?.emailAddress,
      });
    } else if (posthog._isIdentified()) {
      posthog.reset();
    }
  }, [isLoaded, user]);

  return null;
}
