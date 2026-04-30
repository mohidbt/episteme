"use client";

import * as React from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SkillToggles } from "./SkillToggles";
import { McpAttach } from "./McpAttach";
import { ApprovalRules } from "./ApprovalRules";
import { ModelPicker } from "./ModelPicker";
import { PermissionToggles, type PermissionsMap } from "./PermissionToggles";

export type AttachedMcp = { name: string; account?: string };
export type ApprovalRule = "auto" | "require" | "never";

export type PermissionsFormState = {
  enabledSkills: string[];
  attachedMcps: AttachedMcp[];
  modelPreference: string;
  approvalRules: Record<string, ApprovalRule>;
  permissions: PermissionsMap;
};

export function PermissionsForm({ initial }: { initial: PermissionsFormState }) {
  const [state, setState] = React.useState<PermissionsFormState>(initial);
  const [saving, setSaving] = React.useState(false);
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

      <Tabs defaultValue="skills">
        <TabsList>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="mcps">MCPs</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="skills">
          <SkillToggles
            enabledSkills={state.enabledSkills}
            onChange={(enabledSkills) =>
              setState((s) => ({ ...s, enabledSkills }))
            }
          />
        </TabsContent>
        <TabsContent value="mcps">
          <McpAttach
            attachedMcps={state.attachedMcps}
            onChange={(attachedMcps) =>
              setState((s) => ({ ...s, attachedMcps }))
            }
          />
        </TabsContent>
        <TabsContent value="rules">
          <ApprovalRules
            approvalRules={state.approvalRules}
            onChange={(approvalRules) =>
              setState((s) => ({ ...s, approvalRules }))
            }
          />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionToggles
            permissions={state.permissions}
            onChange={(permissions) =>
              setState((s) => ({ ...s, permissions }))
            }
          />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
