"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

/**
 * How often a page reloads its own server data while a job is working. A
 * running job writes one progress line per batch of work it finishes, which is
 * seconds apart, so five seconds shows each new line while it still means
 * something and asks the server for twelve renders a minute at most. Nothing
 * polls when nothing is happening.
 */
const POLL_MS = 5000;

/**
 * How many things on screen are keeping the page fresh on their own. While any
 * is, the poll stands down. The first sweep reads its own status every second
 * and reads the page again whenever a lead lands, so a full re-render every
 * five seconds on top of it drew the same page again for nothing.
 */
let holds = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setHolds(next: number): void {
  holds = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Stands the poll down while `active` holds and the caller is on screen. */
export function useHoldActivityPoll(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    setHolds(holds + 1);
    return () => setHolds(holds - 1);
  }, [active]);
}

/** Re-reads the page from the server while this project has work in flight. */
export function ActivityPoll({ busy }: { busy: boolean }) {
  const router = useRouter();
  const held = useSyncExternalStore(
    subscribe,
    () => holds > 0,
    () => false,
  );
  useEffect(() => {
    if (!busy || held) {
      return;
    }
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, held, router]);
  return null;
}
