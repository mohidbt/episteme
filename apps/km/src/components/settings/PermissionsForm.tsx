"use client";

import * as React from "react";
import { toast } from "sonner";
import { PillSwitcher } from "@/components/ui/PillSwitcher";
import { Button } from "@/components/ui/button";
import { SkillToggles } from "./SkillToggles";
import { McpAttach } from "./McpAttach";
import { ApprovalRules } from "./ApprovalRules";
import { ModelPicker } from "./ModelPicker";
import { PermissionToggles, type PermissionsMap } from "./PermissionToggles";
import { ConfigExportImport } from "./ConfigExportImport";

export type AttachedMcp = { name: string; account?: string };
export type ApprovalRule = "auto" | "require" | "never";

export type PermissionsFormState = {
  enabledSkills: string[];
  attachedMcps: AttachedMcp[];
  modelPreference: string;
  approvalRules: Record<string, ApprovalRule>;
  permissions: PermissionsMap;
};

type Section = "skills" | "mcps" | "rules" | "permissions" | "export";

export function PermissionsForm({ initial }: { initial: PermissionsFormState }) {
  const [state, setState] = React.useState<PermissionsFormState>(initial);
  const [saving, setSaving] = React.useState(false);
  const [section, setSection] = React.useState<Section>("skills");
  // Task #34: track the last-saved baseline so dirty resets after a successful
  // save. The `initial` prop stays fixed at the mount-time value, which would
  // otherwise leave the Save button enabled forever after the first save.
  const [baseline, setBaseline] = React.useState<PermissionsFormState>(initial);

  const dirty = React.useMemo(
    () => JSON.stringify(state) !== JSON.stringify(baseline),
    [state, baseline],
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/agents/km/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledSkills: state.enabledSkills,
          attachedMcps: state.attachedMcps,
          modelPreference: state.modelPreference,
          approvalRules: state.approvalRules,
          permissions: state.permissions,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      // Snapshot the just-saved state as the new baseline so `dirty` flips
      // back to false until the user makes another change.
      setBaseline(state);
      toast.success("Settings saved");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="text-sm font-medium mb-1">Default model</div>
        <p className="text-xs text-muted-foreground mb-3">
          Used by your agents unless overridden per-task.
        </p>
        <ModelPicker
          value={state.modelPreference}
          onChange={(modelPreference) =>
            setState((s) => ({ ...s, modelPreference }))
          }
        />
      </section>

      <div className="flex flex-col gap-3">
        <PillSwitcher<Section>
          value={section}
          onValueChange={setSection}
          ariaLabel="Settings section"
          options={[
            { value: "skills", label: "Skills", testId: "perm-section-skills" },
            { value: "mcps", label: "MCPs", testId: "perm-section-mcps" },
            { value: "rules", label: "Permissions", testId: "perm-section-rules" },
            { value: "permissions", label: "Tools", testId: "perm-section-permissions" },
            { value: "export", label: "Export", testId: "perm-section-export" },
          ]}
        />
        <div role="region" aria-label={`${section} settings`} className="flex-1">
          {section === "skills" && (
            <SkillToggles
              enabledSkills={state.enabledSkills}
              onChange={(enabledSkills) =>
                setState((s) => ({ ...s, enabledSkills }))
              }
            />
          )}
          {section === "mcps" && (
            <McpAttach
              attachedMcps={state.attachedMcps}
              onChange={(attachedMcps) =>
                setState((s) => ({ ...s, attachedMcps }))
              }
            />
          )}
          {section === "rules" && (
            <ApprovalRules
              approvalRules={state.approvalRules}
              onChange={(approvalRules) =>
                setState((s) => ({ ...s, approvalRules }))
              }
            />
          )}
          {section === "permissions" && (
            <PermissionToggles
              permissions={state.permissions}
              onChange={(permissions) =>
                setState((s) => ({ ...s, permissions }))
              }
            />
          )}
          {section === "export" && <ConfigExportImport />}
        </div>
      </div>

      {section !== "export" && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
