"use client";

import { useEffect } from "react";

/**
 * Holds the page still while something covers it. Without it a phone has two
 * scrollers, the cover and the page under it, and a swipe that reaches the end
 * of one carries on into the other. With `maxWidth`, only below that width: the
 * leads pane covers the list on a phone and sits beside it everywhere else.
 */
export function ScrollLock({ maxWidth }: { maxWidth?: number }) {
  useEffect(() => {
    const narrow = maxWidth ? window.matchMedia(`(max-width: ${maxWidth - 0.02}px)`) : null;
    const root = document.documentElement;
    let before: string | null = null;
    const apply = () => {
      const lock = !narrow || narrow.matches;
      if (lock && before === null) {
        before = root.style.overflow;
        root.style.overflow = "hidden";
      } else if (!lock && before !== null) {
        root.style.overflow = before;
        before = null;
      }
    };
    apply();
    narrow?.addEventListener("change", apply);
    return () => {
      narrow?.removeEventListener("change", apply);
      if (before !== null) {
        root.style.overflow = before;
      }
    };
  }, [maxWidth]);
  return null;
}
