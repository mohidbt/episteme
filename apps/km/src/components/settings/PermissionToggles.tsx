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
}> = [
  {
    name: "web_search",
    title: "Web search",
    description:
      "Allow the agent to fall back to web search when internal library and specialized paper-search tools fail. Backup only — disabled by default.",
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
        const checked = Boolean(permissions[perm.name]);
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
