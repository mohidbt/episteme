// GSD-9 — Skills-only export. The /api/agent/export route returns the FULL
// agent-config bundle (agent_config.json + settings.json + memory.md +
// skills/ + skills-personal/). The Skills tab "Export skills" button is
// supposed to export ONLY the skill folders (system + personal). The full
// bundle is still available from the settings/data full-config export.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildSkillsOnlyBundle,
  type AgentConfigSnapshot,
} from "../agent-config-bundle";

const snapshot: AgentConfigSnapshot = {
  agentConfig: {
    enabledSkills: ["lit-triage"],
    attachedMcps: [],
    modelPreference: "openai/gpt-5.4",
    approvalRules: { foo: "bar" },
    settingsJson: { hello: "world" },
  },
  skills: [
    { path: ".episteme/agents/skills/my-custom-thing/SKILL.md", body: "user skill body" },
  ],
  personalSkills: [
    { slug: "personal-one", json: '{"slug":"personal-one"}' },
  ],
  memories: [
    { path: ".episteme/agents/memories/diary.md", body: "private" },
  ],
};

describe("buildSkillsOnlyBundle (GSD-9)", () => {
  it("emits only skill .md files + personal SKILL.json — no config / settings / memories", async () => {
    const bytes = await buildSkillsOnlyBundle(snapshot);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();

    // Sanity: should contain skill entries
    expect(names).toContain(
      ".episteme/agents/skills/my-custom-thing/SKILL.md",
    );
    expect(names).toContain(
      ".episteme/agents/skills-personal/personal-one/SKILL.json",
    );

    // Must NOT contain full-bundle entries
    expect(names).not.toContain("agent_config.json");
    expect(names).not.toContain("memory.md");
    expect(names).not.toContain("settings.json");
    // And no memory paths
    for (const n of names) {
      expect(n.startsWith(".episteme/agents/memories/")).toBe(false);
    }
  });

  it("still applies the system-skill allowlist filter", async () => {
    const withSystem: AgentConfigSnapshot = {
      ...snapshot,
      skills: [
        { path: ".episteme/agents/skills/paper-search/SKILL.md", body: "sys" },
        { path: ".episteme/agents/skills/my-custom-thing/SKILL.md", body: "mine" },
      ],
    };
    const bytes = await buildSkillsOnlyBundle(withSystem);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toContain(
      ".episteme/agents/skills/my-custom-thing/SKILL.md",
    );
    expect(names).not.toContain(
      ".episteme/agents/skills/paper-search/SKILL.md",
    );
  });
});
