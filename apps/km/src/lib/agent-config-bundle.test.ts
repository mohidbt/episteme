// Phase 1.4.x — Task 9: agent-config bundle export/import.
//
// We keep tests on the *pure* core (zip serialization, OAuth strip, diff,
// parse/round-trip). The DB-bound `buildBundle(userId)` / `applyBundle(userId)`
// composers are thin wrappers tested at the route level (Task 10) and E2E
// (Task 13) — mirroring how `cell-write.test.ts` keeps lib tests pure.

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import {
  buildBundleFromSnapshot,
  diffSnapshots,
  filterExportableSkills,
  parseBundle,
  serializeAgentConfig,
  SYSTEM_SKILL_SLUGS,
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
          { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "alpha" },
          { path: ".episteme/agents/skills/deep-read/SKILL.md", body: "beta" },
        ],
      }),
    );
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file(".episteme/agents/skills/lit-triage/SKILL.md")).toBeNull();
    expect(zip.file(".episteme/agents/skills/deep-read/SKILL.md")).toBeNull();
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

  it("rejects traversal and non-canonical bundle entries", async () => {
    const zip = new JSZip();
    zip.file("agent_config.json", "{}");
    zip.file("settings.json", "{}");
    zip.file("memory.md", "");
    zip.file("../escape.json", "{}");
    await expect(
      parseBundle(await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow(/unsafe path|unsupported entry/);
  });

  it("rejects highly-compressible oversized entries before expansion", async () => {
    const zip = new JSZip();
    zip.file("agent_config.json", "{}");
    zip.file("settings.json", "{}");
    zip.file("memory.md", "a".repeat(1024 * 1024 + 1));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    expect(bytes.byteLength).toBeLessThan(20_000);
    await expect(parseBundle(bytes)).rejects.toThrow(/entry too large/);
  });

  it("rejects unsafe personal-skill slugs", async () => {
    const zip = new JSZip();
    zip.file("agent_config.json", "{}");
    zip.file("settings.json", "{}");
    zip.file("memory.md", "");
    zip.file(
      ".episteme/agents/skills-personal/not/one-slug/SKILL.json",
      "{}",
    );
    await expect(
      parseBundle(await zip.generateAsync({ type: "uint8array" })),
    ).rejects.toThrow(/unsupported entry/);
  });

  it("strips system skills even when multiple are present (B13)", async () => {
    const zip = await buildBundleFromSnapshot(
      snap({
        skills: [
          { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "alpha" },
          { path: ".episteme/agents/skills/synthesis/SKILL.md", body: "beta\nbeta-line2" },
        ],
      }),
    );
    const parsed = await parseBundle(zip);
    expect(parsed.skills).toEqual([]);
  });
});

describe("SYSTEM_SKILL_SLUGS — derived from services/agents/skills/ on disk (G3)", () => {
  // Resolve the canonical disk source of truth: services/agents/skills/<slug>/.
  // Filter: skip dirs starting with `_` or `.` (e.g. `_deep-read`, `__pycache__`).
  const skillsDir = path.resolve(
    __dirname,
    "../../../../services/agents/skills",
  );
  const diskSlugs = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => !n.startsWith("_") && !n.startsWith("."));

  it("includes every non-underscored disk skill directory", () => {
    for (const slug of diskSlugs) {
      expect(SYSTEM_SKILL_SLUGS.has(slug)).toBe(true);
    }
  });

  it("filters out a disk-only skill that is not in any prior hardcoded list", () => {
    // Pick a real disk slug; the dynamic allowlist must filter it out on export
    // even if it had never been added to a hand-maintained Set.
    expect(diskSlugs.length).toBeGreaterThan(0);
    const slug = diskSlugs[diskSlugs.length - 1];
    const filtered = filterExportableSkills([
      { path: `.episteme/agents/skills/${slug}/SKILL.md`, body: "x" },
    ]);
    expect(filtered).toEqual([]);
  });

  it("excludes directories starting with `_` or `.`", () => {
    expect(SYSTEM_SKILL_SLUGS.has("_deep-read")).toBe(false);
    expect(SYSTEM_SKILL_SLUGS.has("__pycache__")).toBe(false);
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
