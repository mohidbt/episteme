// Phase 1.4.x — Task 9: agent-config bundle export/import.
//
// We keep tests on the *pure* core (zip serialization, OAuth strip, diff,
// parse/round-trip). The DB-bound `buildBundle(userId)` / `applyBundle(userId)`
// composers are thin wrappers tested at the route level (Task 10) and E2E
// (Task 13) — mirroring how `cell-write.test.ts` keeps lib tests pure.

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildBundleFromSnapshot,
  diffSnapshots,
  parseBundle,
  serializeAgentConfig,
  type AgentConfigSnapshot,
  type PersonalSkillEntry,
} from "./agent-config-bundle";

function snap(over: Partial<AgentConfigSnapshot> = {}): AgentConfigSnapshot {
  return {
    agentConfig: {
      enabledSkills: ["lit-triage"],
      attachedMcps: [],
      modelPreference: "anthropic/claude-3.5-sonnet",
      approvalRules: { web_search: "auto" },
      settingsJson: { permissions: { web_search: true } },
    },
    skills: [
      { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "# triage\nbody1" },
    ],
    personalSkills: [],
    memories: [
      { path: ".episteme/agents/memories/foo.md", body: "remember foo" },
    ],
    ...over,
  };
}

describe("serializeAgentConfig — OAuth strip", () => {
  it("drops oauth_tokens / accessToken / refreshToken from attachedMcps entries", () => {
    const out = serializeAgentConfig({
      enabledSkills: ["x"],
      attachedMcps: [
        {
          name: "linear",
          url: "https://mcp.linear.app",
          oauth_tokens: { accessToken: "a", refreshToken: "b" },
          accessToken: "top-level-a",
          refreshToken: "top-level-b",
          oauth_token: "top-level-c",
        },
      ],
      modelPreference: "m",
      approvalRules: {},
      settingsJson: {},
    });
    const mcp = out.attachedMcps[0] as Record<string, unknown>;
    expect(mcp.name).toBe("linear");
    expect(mcp.url).toBe("https://mcp.linear.app");
    expect(mcp.oauth_tokens).toBeUndefined();
    expect(mcp.accessToken).toBeUndefined();
    expect(mcp.refreshToken).toBeUndefined();
    expect(mcp.oauth_token).toBeUndefined();
  });

  it("does not export user_id even if present on input", () => {
    const out = serializeAgentConfig({
      user_id: "uid-1",
      userId: "uid-1",
      enabledSkills: [],
      attachedMcps: [],
      modelPreference: "m",
      approvalRules: {},
      settingsJson: {},
    });
    expect((out as Record<string, unknown>).user_id).toBeUndefined();
    expect((out as Record<string, unknown>).userId).toBeUndefined();
  });
});

describe("buildBundleFromSnapshot + parseBundle — round trip", () => {
  it("round-trips snapshot through zip — system skills filtered out on export (B13)", async () => {
    const s = snap();
    const zip = await buildBundleFromSnapshot(s);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.byteLength).toBeGreaterThan(0);

    const parsed = await parseBundle(zip);
    expect(parsed.agent_config.enabledSkills).toEqual(["lit-triage"]);
    expect(parsed.agent_config.modelPreference).toBe("anthropic/claude-3.5-sonnet");
    // B13: system skills (.episteme/agents/skills/*) are stripped on export.
    expect(parsed.skills).toHaveLength(0);
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories[0].path).toBe(".episteme/agents/memories/foo.md");
    expect(parsed.memories[0].body.trim()).toBe("remember foo");
  });

  it("filters all system-scoped skills from the exported zip (B13)", async () => {
    const zipBytes = await buildBundleFromSnapshot(
      snap({
        skills: [
          { path: ".episteme/agents/skills/a/SKILL.md", body: "alpha" },
          { path: ".episteme/agents/skills/b/SKILL.md", body: "beta" },
        ],
      }),
    );
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file(".episteme/agents/skills/a/SKILL.md")).toBeNull();
    expect(zip.file(".episteme/agents/skills/b/SKILL.md")).toBeNull();
    const parsed = await parseBundle(zipBytes);
    expect(parsed.skills).toEqual([]);
  });

  it("does not include skills.md in exported zip", async () => {
    const s = snap();
    const zipBytes = await buildBundleFromSnapshot(s);
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file("skills.md")).toBeNull();
  });

  it("includes personal skills as .episteme/agents/skills-personal/<slug>/SKILL.json", async () => {
    const personalSkills: PersonalSkillEntry[] = [
      { slug: "tone", json: JSON.stringify({ name: "Tone", description: "", instructions: "Be concise" }) },
      { slug: "voice", json: JSON.stringify({ name: "Voice", description: "Writing style", instructions: "Use active voice" }) },
    ];
    const s = snap({ personalSkills });
    const zipBytes = await buildBundleFromSnapshot(s);
    const zip = await JSZip.loadAsync(zipBytes);
    await expect(zip.file(".episteme/agents/skills-personal/tone/SKILL.json")?.async("string")).resolves.toBe(personalSkills[0].json);
    await expect(zip.file(".episteme/agents/skills-personal/voice/SKILL.json")?.async("string")).resolves.toBe(personalSkills[1].json);

    const parsed = await parseBundle(zipBytes);
    expect(parsed.personalSkills).toHaveLength(2);
    expect(parsed.personalSkills[0].slug).toBe("tone");
    expect(parsed.personalSkills[1].slug).toBe("voice");
  });

  it("handles empty skills/memories/personalSkills", async () => {
    const zip = await buildBundleFromSnapshot(snap({ skills: [], personalSkills: [], memories: [] }));
    const parsed = await parseBundle(zip);
    expect(parsed.skills).toEqual([]);
    expect(parsed.personalSkills).toEqual([]);
    expect(parsed.memories).toEqual([]);
  });

  it("strips system skills even when multiple are present (B13)", async () => {
    const zip = await buildBundleFromSnapshot(
      snap({
        skills: [
          { path: ".episteme/agents/skills/a/SKILL.md", body: "alpha" },
          { path: ".episteme/agents/skills/b/SKILL.md", body: "beta\nbeta-line2" },
        ],
      }),
    );
    const parsed = await parseBundle(zip);
    expect(parsed.skills).toEqual([]);
  });
});

describe("diffSnapshots", () => {
  const base = snap();

  it("detects added skill (in bundle, not local)", () => {
    const local = snap({ skills: [] });
    const diff = diffSnapshots(local, base);
    expect(diff.skills.added).toEqual([".episteme/agents/skills/lit-triage/SKILL.md"]);
    expect(diff.skills.removed).toEqual([]);
    expect(diff.skills.modified).toEqual([]);
  });

  it("detects removed skill (in local, not bundle)", () => {
    const bundle = snap({ skills: [] });
    const diff = diffSnapshots(base, bundle);
    expect(diff.skills.removed).toEqual([".episteme/agents/skills/lit-triage/SKILL.md"]);
  });

  it("detects modified skill (path matches, body differs)", () => {
    const bundle = snap({
      skills: [
        { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "DIFFERENT" },
      ],
    });
    const diff = diffSnapshots(base, bundle);
    expect(diff.skills.modified).toEqual([".episteme/agents/skills/lit-triage/SKILL.md"]);
  });

  it("treats whitespace-only body diff as unchanged", () => {
    const bundle = snap({
      skills: [
        { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "  # triage\nbody1  " },
      ],
    });
    const diff = diffSnapshots(base, bundle);
    expect(diff.skills.modified).toEqual([]);
  });

  it("detects settings keys changed (model_preference flip)", () => {
    const bundle = snap({
      agentConfig: { ...base.agentConfig, modelPreference: "openai/gpt-4o" },
    });
    const diff = diffSnapshots(base, bundle);
    expect(diff.settings.changed).toContain("modelPreference");
  });

  it("detects added/removed/modified personal skills", () => {
    const local = snap({
      personalSkills: [
        { slug: "tone", json: '{"name":"Tone"}' },
        { slug: "old", json: '{"name":"Old"}' },
      ],
    });
    const bundle = snap({
      personalSkills: [
        { slug: "tone", json: '{"name":"Tone"}' },
        { slug: "new-skill", json: '{"name":"New"}' },
        { slug: "old", json: '{"name":"Changed"}' },
      ],
    });
    const diff = diffSnapshots(local, bundle);
    expect(diff.personalSkills.added).toEqual(["new-skill"]);
    expect(diff.personalSkills.removed).toEqual([]);
    expect(diff.personalSkills.modified).toEqual(["old"]);
  });
});
