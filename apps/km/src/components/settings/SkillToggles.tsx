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
import { SKILLS } from "@/lib/skills";
import { PersonalSkills } from "./PersonalSkills";

// Pull a filename out of a Content-Disposition header. Falls back to a
// stable default if the server didn't set one (or we can't parse it).
function filenameFromDisposition(header: string | null): string {
  const fallback = `episteme-agent-config-${Date.now()}.zip`;
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
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
      // GSD-9: scoped endpoint emitting only skill folders (system-allowlist
      // + personal). The full agent-config bundle lives behind the data tab's
      // ConfigExportImport widget at /api/agent/export.
      const res = await fetch("/api/agent/export-skills", { method: "GET" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
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
    </div>
  );
}
