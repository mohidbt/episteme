"use client";

import * as React from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "@/components/ui/select";
import { fetchModelCatalog } from "@/lib/openrouter-catalog";

export type CatalogModel = {
  id: string;
  name?: string;
};

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [models, setModels] = React.useState<CatalogModel[]>([]);
  const [loading, setLoading] = React.useState(true);

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

  const free = models.filter((m) => m.id.endsWith(":free"));
  const paid = models.filter((m) => !m.id.endsWith(":free"));

  return (
    <Select
      value={value}
      onValueChange={(v: string | null) => {
        if (v) onChange(v);
      }}
    >
      <SelectTrigger
        className="w-full max-w-md"
        aria-label="Model preference"
        data-testid="model-picker-trigger"
      >
        <SelectValue placeholder={loading ? "Loading models..." : "Select a model"} />
      </SelectTrigger>
      <SelectContent>
        {free.length > 0 && (
          <SelectGroup>
            <SelectLabel>Free</SelectLabel>
            {free.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name ?? m.id}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {free.length > 0 && paid.length > 0 && <SelectSeparator />}
        {paid.length > 0 && (
          <SelectGroup>
            <SelectLabel>Paid</SelectLabel>
            {paid.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name ?? m.id}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {!loading && models.length === 0 && (
          <SelectGroup>
            <SelectItem value={value}>{value}</SelectItem>
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
