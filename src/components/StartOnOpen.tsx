"use client";

import { useEffect } from "react";

/** Fires a tab's first job once the tab is really on screen; see src/lib/startOnOpen.ts. */
export function StartOnOpen({ start }: { start: () => Promise<void> }) {
  useEffect(() => {
    void start();
    // Once per mount: the action itself refuses a second job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
