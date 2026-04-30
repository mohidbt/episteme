"use client";

import * as React from "react";
import { ChevronsUpDownIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { fetchModelCatalog } from "@/lib/openrouter-catalog";
import { cn } from "@/lib/utils";

export type CatalogModel = {
  id: string;
  name?: string;
  // OpenRouter exposes a `created` Unix timestamp (seconds) for each model;
  // we treat that as the release date.
  created?: number;
  [key: string]: unknown;
};

/**
 * Sort:
 *  - models with `created` ascending (oldest first)
 *  - models without `created` after, alphabetical by display name
 */
export function sortByReleaseDate(models: CatalogModel[]): CatalogModel[] {
  const dated: CatalogModel[] = [];
  const undated: CatalogModel[] = [];
  for (const m of models) {
    if (typeof m.created === "number" && Number.isFinite(m.created)) {
      dated.push(m);
    } else {
      undated.push(m);
    }
  }
  dated.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  undated.sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
      sensitivity: "base",
    }),
  );
  return [...dated, ...undated];
}

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [models, setModels] = React.useState<CatalogModel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await fetchModelCatalog();
        if (cancelled) return;
        setModels(Array.isArray(body.models) ? body.models : []);
      } catch {
        if (!cancelled) setModels([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = React.useMemo(() => sortByReleaseDate(models), [models]);
  const selected = sorted.find((m) => m.id === value);
  const triggerLabel = loading
    ? "Loading models..."
    : (selected?.name ?? value ?? "Select a model");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Model preference"
            data-testid="model-picker-trigger"
            className="w-full max-w-md justify-between font-normal"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className={cn("w-[--anchor-width] min-w-[20rem] p-0")}
        align="start"
      >
        <Command
          // Custom filter so we match against id + name (not just value/id).
          filter={(itemValue, search) => {
            if (!search) return 1;
            return itemValue.toLowerCase().includes(search.toLowerCase())
              ? 1
              : 0;
          }}
        >
          <CommandInput
            placeholder="Search models..."
            data-testid="model-picker-search"
          />
          <CommandList>
            <CommandEmpty>No models match.</CommandEmpty>
            <CommandGroup>
              {sorted.map((m) => {
                const label = m.name ?? m.id;
                return (
                  <CommandItem
                    key={m.id}
                    // cmdk uses `value` for filtering. Concatenate label + id
                    // so search matches either.
                    value={`${label} ${m.id}`}
                    data-testid="model-picker-item"
                    data-checked={m.id === value ? "true" : undefined}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
