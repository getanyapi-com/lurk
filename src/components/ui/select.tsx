"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = {
  /** What the option list offers, in the order it should read. */
  options: SelectOption[];
  /** Controlled value. Leave it out and pass defaultValue for an uncontrolled one. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Submits with a form, the way a native select's name does. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
  /**
   * "pill" is the filter row over a feed, which sits inside its own bordered
   * chip and so draws no border of its own. "field" is a form control that has
   * to look like the inputs beside it.
   */
  shape?: "pill" | "field";
  className?: string;
};

const TRIGGER: Record<"pill" | "field", string> = {
  pill: "text-small h-6 gap-1.5 pr-1 pl-0.5 text-fg",
  field: "text-small h-8 gap-2 rounded-control border bg-surface px-2 text-fg",
};

/**
 * The one dropdown in the app. A native select cannot be told what its own
 * option list looks like, so on a dark theme the list came back white from the
 * platform and every filter row read as somebody else's control. This one is
 * ours in both themes, keyboard and screen reader behaviour included.
 */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  disabled,
  ariaLabel,
  placeholder,
  shape = "field",
  className,
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(String(next ?? ""))}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-0 max-w-full cursor-default items-center justify-between select-none outline-none",
          "focus-visible:ring-2 focus-visible:ring-fg-muted/40 disabled:opacity-50",
          TRIGGER[shape],
          className,
        )}
      >
        <SelectPrimitive.Value className="truncate" placeholder={placeholder} />
        <SelectPrimitive.Icon className="shrink-0">
          <ChevronsUpDown className="size-3.5 text-fg-muted" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner className="z-50 outline-none" sideOffset={6}>
          <SelectPrimitive.Popup
            className={cn(
              "min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-card",
              "border bg-surface py-1 shadow-lg shadow-black/10 outline-none",
              "transition-[opacity,scale] duration-100 ease-out",
              "data-starting-style:scale-[0.98] data-starting-style:opacity-0",
              "data-ending-style:scale-[0.98] data-ending-style:opacity-0",
            )}
          >
            <SelectPrimitive.List className="max-h-[var(--available-height)] overflow-y-auto">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    "text-small grid cursor-default grid-cols-[1rem_1fr] items-center gap-2",
                    "py-1.5 pr-3 pl-2 text-fg outline-none select-none",
                    "data-highlighted:bg-surface-2 data-disabled:opacity-50",
                  )}
                >
                  <SelectPrimitive.ItemIndicator className="col-start-1">
                    <Check className="size-3.5" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText className="col-start-2 truncate">
                    {option.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
