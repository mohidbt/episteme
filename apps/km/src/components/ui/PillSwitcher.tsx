"use client";

// #53 — Single source-of-truth for the segmented "pill" switcher used both
// for the drive grid/list view toggle and the /settings/agents 4-section
// switcher. Wraps the existing ToggleGroup primitive so both surfaces
// render the *exact same* visual element.
//
// Drive consumer: FileBrowserToolbar
// Settings consumer: PermissionsForm
import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface PillSwitcherOption<T extends string> {
  value: T;
  label: React.ReactNode;
  ariaLabel?: string;
  testId?: string;
}

interface Props<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: PillSwitcherOption<T>[];
  ariaLabel?: string;
  className?: string;
}

export function PillSwitcher<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(vals) => {
        const next = vals[0] as T | undefined;
        if (next) onValueChange(next);
      }}
      aria-label={ariaLabel}
      className={className}
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          aria-label={opt.ariaLabel ?? (typeof opt.label === "string" ? opt.label : undefined)}
          data-testid={opt.testId}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
