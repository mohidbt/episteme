"use client";

import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldContent,
} from "@/components/ui/field";
import type { ApprovalRule } from "./PermissionsForm";

const TOOLS: Array<{ name: string; label: string; description: string }> = [
  { name: "create_note", label: "Create note", description: "Agent creates a new note in your library." },
  { name: "update_note", label: "Update note", description: "Agent edits the contents of an existing note." },
  { name: "publish", label: "Publish", description: "Agent publishes a note externally. 'Never' is not allowed." },
  { name: "delete_note", label: "Delete note", description: "Agent moves a note to trash." },
  { name: "external_send", label: "External send", description: "Agent sends data to an external service (email, slack, etc)." },
];

const OPTIONS: Array<{ value: ApprovalRule; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "require", label: "Require" },
  { value: "never", label: "Never" },
];

export function ApprovalRules({
  approvalRules,
  onChange,
}: {
  approvalRules: Record<string, ApprovalRule>;
  onChange: (next: Record<string, ApprovalRule>) => void;
}) {
  function setRule(tool: string, value: ApprovalRule) {
    onChange({ ...approvalRules, [tool]: value });
  }

  return (
    <FieldGroup>
      {TOOLS.map((tool) => {
        const current: ApprovalRule = approvalRules[tool.name] ?? "require";
        return (
          <Field key={tool.name}>
            <FieldContent>
              <FieldLabel>{tool.label}</FieldLabel>
              <FieldDescription>{tool.description}</FieldDescription>
            </FieldContent>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[current]}
              onValueChange={(values: string[]) => {
                const v = values[0] as ApprovalRule | undefined;
                if (v) setRule(tool.name, v);
              }}
              aria-label={`approval rule for ${tool.label}`}
            >
              {OPTIONS.map((opt) => (
                <ToggleGroupItem
                  key={opt.value}
                  value={opt.value}
                  disabled={tool.name === "publish" && opt.value === "never"}
                  aria-label={opt.label}
                >
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        );
      })}
    </FieldGroup>
  );
}
