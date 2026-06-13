"use client";

import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import type { ApprovalRule } from "./PermissionsForm";

const OPTIONS: Array<{ value: ApprovalRule; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "require", label: "Require" },
  { value: "never", label: "Never" },
];

// publish is a permanent-publish action — disallowing "never" matches the
// legacy hardcoded list behavior. The agent service enforces this server-side
// too; this is a UX guard.
const NEVER_DISALLOWED = new Set<string>(["publish"]);

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; tools: ToolInventoryEntry[] }
  | { kind: "error"; message: string };

export function ApprovalRules({
  approvalRules,
  onChange,
}: {
  approvalRules: Record<string, ApprovalRule>;
  onChange: (next: Record<string, ApprovalRule>) => void;
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

  function setRule(tool: string, value: ApprovalRule) {
    onChange({ ...approvalRules, [tool]: value });
  }

  if (state.kind === "loading") {
    return (
      <div
        data-testid="approval-rules-loading"
        className="text-sm text-muted-foreground"
      >
        Loading tools…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        data-testid="approval-rules-error"
        className="text-sm text-destructive"
      >
        Failed to load tools: {state.message}
      </div>
    );
  }

  const groups = groupByCategory(state.tools);
  const liveNames = new Set(state.tools.map((t) => t.name));
  // Saved approval rules for tools no longer in the live list — surface in a
  // "Removed" group so users can see and clean them up instead of silently
  // dropping persisted user state.
  const removedNames = Object.keys(approvalRules).filter(
    (n) => !liveNames.has(n),
  );

  // GSD-103 — index live tools by name so we can read each tool's
  // `default_approval` from the inventory when the user has no explicit
  // saved rule. Without this the UI hard-defaulted to "require" for every
  // tool, lying about the server's true default ("auto" for non-destructive
  // tools per `_DEFAULT_APPROVAL_RULES`).
  const liveByName: Map<string, ToolInventoryEntry> =
    state.kind === "ready"
      ? new Map(state.tools.map((t) => [t.name, t]))
      : new Map();

  function renderToolField(name: string, opts: { removed?: boolean } = {}) {
    const fallback: ApprovalRule =
      liveByName.get(name)?.default_approval ?? "require";
    const current: ApprovalRule = approvalRules[name] ?? fallback;
    const label = humanizeToolName(name);
    return (
      <Field key={name}>
        <FieldContent>
          <FieldLabel>
            {label}
            {opts.removed && (
              <span className="ml-2 text-xs text-muted-foreground">
                (removed)
              </span>
            )}
          </FieldLabel>
        </FieldContent>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[current]}
          onValueChange={(values: string[]) => {
            const v = values[0] as ApprovalRule | undefined;
            if (v) setRule(name, v);
          }}
          aria-label={`approval rule for ${label}`}
        >
          {OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              disabled={NEVER_DISALLOWED.has(name) && opt.value === "never"}
              aria-label={opt.label}
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ category, tools }) => (
        <Collapsible key={category} defaultOpen>
          <CollapsibleTrigger className="text-sm font-medium text-left w-full py-1">
            {humanizeCategory(category)}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldGroup>
              {tools.map((tool) => renderToolField(tool.name))}
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>
      ))}
      {removedNames.length > 0 && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="text-sm font-medium text-left w-full py-1">
            Removed
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldGroup>
              {removedNames.map((n) => renderToolField(n, { removed: true }))}
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
