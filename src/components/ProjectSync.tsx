"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Redraws the app shell when the URL moves to another project. A layout is not
 * rendered again when only the query string changes, so switching project, or
 * going back to one, left the rail counting for the project it was drawn for.
 */
export function ProjectSync({ drawnFor }: { drawnFor: string }) {
  const router = useRouter();
  const requested = useSearchParams().get("project") ?? "";
  useEffect(() => {
    if (requested !== drawnFor) router.refresh();
  }, [requested, drawnFor, router]);
  return null;
}
