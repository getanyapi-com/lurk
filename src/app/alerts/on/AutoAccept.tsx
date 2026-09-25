"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * Presses the button for the person as the page opens, so the link in the
 * invite is one click. The button stays for a browser that runs no script.
 */
export function AutoAccept({ action }: { action: () => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.requestSubmit();
  }, []);
  return (
    <form ref={form} action={action}>
      <Button type="submit" size="lg" className="w-full">
        Turn on email alerts
      </Button>
    </form>
  );
}
