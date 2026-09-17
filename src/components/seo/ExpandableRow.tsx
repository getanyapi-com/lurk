"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One table row that opens its own detail underneath. The table keeps every
 * thread comparable down a column; this is what stops that costing the reader
 * the facts a card would have shown, without sending them to another page.
 */
export function ExpandableRow({
  cells,
  detail,
  span,
  label,
}: {
  cells: React.ReactNode;
  detail: React.ReactNode;
  /** How many columns the detail has to reach under, which the table knows. */
  span: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen(!open)}
        className={cn(
          "transition-motion cursor-pointer border-b last:border-b-0",
          open ? "bg-surface-2" : "hover:bg-surface-2",
        )}
      >
        {cells}
        <td className="w-8 px-2 py-3.5 align-top">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} the facts behind ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(!open);
            }}
            className="text-fg-muted hover:text-fg"
          >
            <ChevronDown
              className={cn("transition-motion size-4 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b last:border-b-0">
          <td colSpan={span + 1} className="p-0">
            {detail}
          </td>
        </tr>
      ) : null}
    </>
  );
}
