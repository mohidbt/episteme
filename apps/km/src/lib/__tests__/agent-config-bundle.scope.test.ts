// Drop EVERY note under `.episteme/agents/skills/` on export. Personal
// skills live under `.episteme/agents/skills-personal/` and ship via the
// separate `personalSkills` bundle array. Allowlist-by-slug was unreliable
// on prod (stale seeded slugs leaked once disk skill set changed).

import { describe, expect, it } from "vitest";
import {
  filterExportableSkills,
  type SkillNote,
} from "../agent-config-bundle";

describe("filterExportableSkills — drop all SKILLS_PREFIX paths", () => {
  it("drops anything under `.episteme/agents/skills/` regardless of slug", () => {
    const skills: SkillNote[] = [
      { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "sys" },
      { path: ".episteme/agents/skills/unknown-slug/SKILL.md", body: "sys-stale" },
      { path: ".episteme/agents/skills/my-custom-skill/SKILL.md", body: "leak" },
      { path: "my-notes/my-custom-skill.md", body: "mine" },
    ];
    const out = filterExportableSkills(skills);
    const paths = out.map((s) => s.path);
    expect(paths).toEqual(["my-notes/my-custom-skill.md"]);
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
});
