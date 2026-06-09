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
import { priceTier, tierLabel, type PriceTier } from "@/lib/openrouter-tier";
import { useSession } from "@episteme/auth/client";
import { cn } from "@/lib/utils";

export type CatalogModel = {
  id: string;
  name?: string;
  // OpenRouter exposes a `created` Unix timestamp (seconds) for each model;
  // we treat that as the release date.
  created?: number;
  // OpenRouter `pricing` is reported as USD-per-token (string). We badge
  // the picker row by completion price only — the dominant cost driver
  // for agent workloads.
  pricing?: { prompt?: string; completion?: string };
  [key: string]: unknown;
};

// GSD-31 — tier → tailwind classes for the badge. Green / yellow / red.
const TIER_CLASSES: Record<PriceTier, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  mid: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function PriceTierBadge({ model }: { model: CatalogModel }) {
  const completion = Number(model.pricing?.completion);
  const tier = priceTier(Number.isFinite(completion) ? completion : null);
  if (tier === null) return null;
  return (
    <span
      data-testid="model-price-tier"
      data-tier={tier}
      aria-label={`Price tier ${tierLabel(tier)}`}
      className={cn(
        "ml-auto rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-none",
        TIER_CLASSES[tier],
      )}
    >
      {tierLabel(tier)}
    </span>
  );
}

/**
 * Sort:
 *  - models with `created` descending (newest first)
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
  dated.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
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
  const session = useSession();
  const isAnonymous =
    (session.data?.user as { isAnonymous?: boolean } | undefined)
      ?.isAnonymous ?? false;

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
  // Anonymous guests are gated behind the signup CTA — hide the catalog so
  // the CommandEmpty branch renders the upgrade prompt instead of a list of
  // selectable models.
  const displayed = isAnonymous ? [] : sorted;
  const selected = sorted.find((m) => m.id === value);
  const triggerLabel = loading
    ? "Loading models..."
    : isAnonymous
      ? "Sign up to select a model"
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
            <CommandEmpty>
              {isAnonymous ? (
                <button
                  type="button"
                  className="text-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.location.href = "/sign-up";
                    }
                  }}
                >
                  Sign up to access all models.
                </button>
              ) : (
                "No models match."
              )}
            </CommandEmpty>
            <CommandGroup>
              {displayed.map((m) => {
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
                    <PriceTierBadge model={m} />
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
