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
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

const SKILLS = [
  {
    name: "lit-triage",
    title: "Literature Triage",
    description: "Skim incoming references and decide what's worth a deeper read.",
  },
  {
    name: "deep-read",
    title: "Deep Read",
    description: "Read papers thoroughly and extract structured findings.",
  },
  {
    name: "synthesis",
    title: "Synthesis",
    description: "Compose synthesis notes that link claims across sources.",
  },
] as const;

export function SkillToggles({
  enabledSkills,
  onChange,
}: {
  enabledSkills: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(name: string, on: boolean) {
    const set = new Set(enabledSkills);
    if (on) set.add(name);
    else set.delete(name);
    onChange(Array.from(set));
  }

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup>
        {SKILLS.map((skill) => {
          const checked = enabledSkills.includes(skill.name);
          return (
            <Field key={skill.name}>
              <FieldContent>
                <FieldLabel htmlFor={`skill-${skill.name}`}>{skill.title}</FieldLabel>
                <FieldDescription>{skill.description}</FieldDescription>
              </FieldContent>
              <Switch
                id={`skill-${skill.name}`}
                checked={checked}
                onCheckedChange={(on) => toggle(skill.name, on)}
                aria-label={skill.title}
              />
            </Field>
          );
        })}
      </FieldGroup>
      {enabledSkills.length === 0 && (
        <Empty>
          <EmptyTitle>No skills enabled</EmptyTitle>
          <EmptyDescription>Enable a skill above to give your agents capabilities.</EmptyDescription>
        </Empty>
      )}
    </div>
  );
}
