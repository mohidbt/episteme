"use client";

import * as React from "react";
import { Switch } from "@/components/ui/switch";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldContent,
} from "@/components/ui/field";

export type PermissionsMap = Record<string, boolean>;

const PERMISSIONS: Array<{
  name: keyof PermissionsMap;
  title: string;
  description: string;
  defaultOn: boolean;
}> = [
  {
    name: "web_search",
    title: "Web search",
    description:
      "Allow the agent to fall back to web search when internal library and specialized paper-search tools fail. Backup only — enabled by default; toggle off to opt out.",
    defaultOn: true,
  },
];

export function PermissionToggles({
  permissions,
  onChange,
}: {
  permissions: PermissionsMap;
  onChange: (next: PermissionsMap) => void;
}) {
  function toggle(name: string, on: boolean) {
    onChange({ ...permissions, [name]: on });
  }

  return (
    <FieldGroup>
      {PERMISSIONS.map((perm) => {
        // K12: default-ON semantics — missing/undefined treated as enabled.
        // Only an explicit `false` renders the switch off.
        const raw = permissions[perm.name];
        const checked = raw === undefined || raw === null ? perm.defaultOn : Boolean(raw);
        return (
          <Field key={perm.name}>
            <FieldContent>
              <FieldLabel htmlFor={`perm-${perm.name}`}>{perm.title}</FieldLabel>
              <FieldDescription>{perm.description}</FieldDescription>
            </FieldContent>
            <Switch
              id={`perm-${perm.name}`}
              checked={checked}
              onCheckedChange={(on) => toggle(perm.name, on)}
              aria-label={perm.title}
            />
          </Field>
        );
      })}
    </FieldGroup>
  );
}
