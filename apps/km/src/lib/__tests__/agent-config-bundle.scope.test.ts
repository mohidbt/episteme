// K1 follow-up: filterExportableSkills must drop ONLY system slugs (from the
// auto-generated allowlist). User-authored notes living under SKILLS_PREFIX
// must be kept — the previous unconditional prefix-strip was over-restrictive
// and erased legitimate user skill notes from exports.

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildBundleFromSnapshot,
  filterExportableSkills,
  serializeAgentConfig,
  type SkillNote,
} from "../agent-config-bundle";

describe("filterExportableSkills — system-slug allowlist only", () => {
  it("drops system slugs but keeps user-authored notes under SKILLS_PREFIX", () => {
    const skills: SkillNote[] = [
      { path: ".episteme/agents/skills/paper-search/SKILL.md", body: "sys" },
      { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "sys" },
      { path: ".episteme/agents/skills/my-custom-thing/SKILL.md", body: "mine" },
      { path: "my-notes/keepme.md", body: "mine" },
    ];
    const out = filterExportableSkills(skills);
    const paths = out.map((s) => s.path).sort();
    expect(paths).toEqual([
      ".episteme/agents/skills/my-custom-thing/SKILL.md",
      "my-notes/keepme.md",
    ]);
  });

  it("drops every system slug seeded from services/agents/skills/*", () => {
    const systemSlugs = [
      "claim-verify",
      "data-extract",
      "deep-read",
      "lit-triage",
      "paper-search",
      "synthesis",
    ];
    const skills: SkillNote[] = systemSlugs.map((slug) => ({
      path: `.episteme/agents/skills/${slug}/SKILL.md`,
      body: slug,
    }));
    expect(filterExportableSkills(skills)).toEqual([]);
  });

  it("keeps user-authored notes outside the SKILLS_PREFIX", () => {
    const skills: SkillNote[] = [
      { path: "my-notes/foo.md", body: "a" },
      { path: "other/bar.md", body: "b" },
    ];
    expect(filterExportableSkills(skills)).toEqual(skills);
  });
});

describe("buildBundleFromSnapshot — zip contents", () => {
  it("ships user-authored skill note + personal skill alongside core files", async () => {
    const zipBytes = await buildBundleFromSnapshot({
      agentConfig: serializeAgentConfig({}),
      skills: [
        // System slug — must be dropped.
        { path: ".episteme/agents/skills/paper-search/SKILL.md", body: "sys" },
        // User-authored under SKILLS_PREFIX — must be kept.
        {
          path: ".episteme/agents/skills/my-custom-thing/SKILL.md",
          body: "mine",
        },
      ],
      personalSkills: [{ slug: "my-personal", json: "{\"slug\":\"my-personal\"}" }],
      memories: [],
    });

    const zip = await JSZip.loadAsync(zipBytes);
    const paths = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(paths).toEqual([
      ".episteme/agents/skills-personal/my-personal/SKILL.json",
      ".episteme/agents/skills/my-custom-thing/SKILL.md",
      "agent_config.json",
      "memory.md",
      "settings.json",
    ]);
  });
});
