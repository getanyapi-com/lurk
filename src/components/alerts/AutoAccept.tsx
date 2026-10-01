"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * Presses the button for the person as the page opens, so a link in an
 * email is one click. The button stays for a browser that runs no script.
 */
export function AutoAccept({
  action,
  label = "Turn on email alerts",
}: {
  action: () => Promise<void>;
  label?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.requestSubmit();
  }, []);
  return (
    <form ref={form} action={action}>
      <Button type="submit" size="lg" className="w-full">
        {label}
      </Button>
    </form>
  );
}
