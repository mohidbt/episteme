"use client";

import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldContent,
} from "@/components/ui/field";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { SKILLS, type Skill } from "@/lib/skills";
import { PersonalSkills } from "./PersonalSkills";

/**
 * Build a SKILL.md body for a single skill. Mirrors the deep-agents skill
 * format (frontmatter + description + instruction body) so an exported skill
 * round-trips when re-imported.
 */
function buildSkillMarkdown(skill: Skill): string {
  return [
    "---",
    `name: ${skill.name}`,
    `title: ${skill.title}`,
    "---",
    "",
    `# ${skill.title}`,
    "",
    skill.description,
    "",
    "## Instruction",
    "",
    skill.instruction,
    "",
  ].join("\n");
}

export async function exportSkillsZip(
  skills: readonly Skill[],
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const skill of skills) {
    zip.file(`${skill.name}/SKILL.md`, buildSkillMarkdown(skill));
  }
  return zip.generateAsync({ type: "blob" });
}

export function SkillToggles({
  enabledSkills,
  onChange,
}: {
  enabledSkills: string[];
  onChange: (next: string[]) => void;
}) {
  const [exporting, setExporting] = React.useState(false);

  function toggle(name: string, on: boolean) {
    const set = new Set(enabledSkills);
    if (on) set.add(name);
    else set.delete(name);
    onChange(Array.from(set));
  }

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await exportSkillsZip(SKILLS);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "episteme-skills.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast.error(`Export failed: ${msg}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
          data-testid="export-skills-button"
        >
          {exporting ? "Exporting..." : "Export skills"}
        </Button>
      </div>
      <div className="text-sm font-medium" data-testid="system-skills-heading">
        System Skills
      </div>
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
      <div className="mt-4">
        <PersonalSkills />
      </div>
    </div>
  );
}
