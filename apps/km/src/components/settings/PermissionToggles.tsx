"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldContent,
} from "@/components/ui/field";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  groupByCategory,
  humanizeCategory,
  humanizeToolName,
  type ToolInventoryEntry,
} from "@/lib/agents/tool-categories";

export type PermissionsMap = Record<string, boolean>;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; tools: ToolInventoryEntry[] }
  | { kind: "error"; message: string };

export function PermissionToggles({
  permissions,
  onChange,
}: {
  permissions: PermissionsMap;
  onChange: (next: PermissionsMap) => void;
}) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agents/km/tools");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { tools: ToolInventoryEntry[] };
        if (!cancelled) setState({ kind: "ready", tools: body.tools ?? [] });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "fetch failed";
          setState({ kind: "error", message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(name: string, on: boolean) {
    onChange({ ...permissions, [name]: on });
  }

  if (state.kind === "loading") {
    return (
      <div data-testid="permission-toggles-loading" className="text-sm text-muted-foreground">
        Loading tools…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div data-testid="permission-toggles-error" className="text-sm text-destructive">
        Failed to load tools: {state.message}
      </div>
    );
  }

  const groups = groupByCategory(state.tools);

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ category, tools }) => (
        <Collapsible key={category} defaultOpen>
          <CollapsibleTrigger className="text-sm font-medium text-left w-full py-1">
            {humanizeCategory(category)}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldGroup>
              {tools.map((tool) => {
                const raw = permissions[tool.name];
                const checked =
                  raw === undefined || raw === null ? true : Boolean(raw);
                return (
                  <Field key={tool.name}>
                    <FieldContent>
                      <FieldLabel htmlFor={`perm-${tool.name}`}>
                        {humanizeToolName(tool.name)}
                      </FieldLabel>
                    </FieldContent>
                    <Switch
                      id={`perm-${tool.name}`}
                      checked={checked}
                      onCheckedChange={(on) => toggle(tool.name, on)}
                      aria-label={humanizeToolName(tool.name)}
                    />
                  </Field>
                );
              })}
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
