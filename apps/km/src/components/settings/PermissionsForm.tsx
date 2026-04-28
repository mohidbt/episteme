"use client";

import * as React from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SkillToggles } from "./SkillToggles";
import { McpAttach } from "./McpAttach";
import { ApprovalRules } from "./ApprovalRules";
import { ModelPicker } from "./ModelPicker";

export type AttachedMcp = { name: string; account?: string };
export type ApprovalRule = "auto" | "require" | "never";

export type PermissionsFormState = {
  enabledSkills: string[];
  attachedMcps: AttachedMcp[];
  modelPreference: string;
  approvalRules: Record<string, ApprovalRule>;
};

export function PermissionsForm({ initial }: { initial: PermissionsFormState }) {
  const [state, setState] = React.useState<PermissionsFormState>(initial);
  const [saving, setSaving] = React.useState(false);

  const dirty = React.useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initial),
    [state, initial],
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
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
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
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
