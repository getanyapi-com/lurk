"use client";

import { Combobox } from "@base-ui/react/combobox";
import { ChevronsUpDown, Check } from "lucide-react";
import { ITEM_CLASS, POPUP_CLASS, TRIGGER, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SearchSelectProps = {
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** What the search box says before anything is typed. */
  searchPlaceholder?: string;
  shape?: "pill" | "field";
  className?: string;
};

/**
 * A dropdown you can type into, for the lists that grow with the project: the
 * communities a scan has found, the phrasings discovery wrote. Those run to
 * dozens and no ordering makes the one you want easy to spot, so the list gets
 * a search box. It wears the same trigger and the same popup as the plain
 * Select, because to a person it is the same control with one more affordance.
 */
export function SearchSelect({
  options,
  value,
  onValueChange,
  ariaLabel,
  placeholder,
  searchPlaceholder,
  shape = "field",
  className,
}: SearchSelectProps) {
  const selected = options.find((option) => option.value === (value ?? "")) ?? null;
  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(next: SelectOption | null) => onValueChange?.(next?.value ?? "")}
      itemToStringLabel={(option: SelectOption) => option.label}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-0 max-w-full cursor-default items-center justify-between select-none outline-none",
          "focus-visible:ring-2 focus-visible:ring-fg-muted/40",
          TRIGGER[shape],
          className,
        )}
      >
        <span className="truncate">
          <Combobox.Value placeholder={placeholder} />
        </span>
        <Combobox.Icon className="shrink-0">
          <ChevronsUpDown className="size-3.5 text-fg-muted" aria-hidden="true" />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner className="z-50 outline-none" align="start" sideOffset={6}>
          <Combobox.Popup className={POPUP_CLASS} aria-label={ariaLabel}>
            <div className="border-b p-1">
              <Combobox.Input
                placeholder={searchPlaceholder ?? "Search"}
                className="text-small h-7 w-full min-w-56 rounded-control bg-surface-2 px-2 text-fg outline-none placeholder:text-fg-muted"
              />
            </div>
            <Combobox.Empty>
              <p className="text-small px-2 py-3 text-fg-muted">Nothing matches that.</p>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain py-1 data-empty:p-0">
              {(option: SelectOption) => (
                <Combobox.Item key={option.value} value={option} className={ITEM_CLASS}>
                  <Combobox.ItemIndicator className="col-start-1">
                    <Check className="size-3.5" aria-hidden="true" />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 truncate">{option.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
