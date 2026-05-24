// K1: defense-in-depth — even if a skill row lacks the `.episteme/agents/skills/`
// path prefix (malformed/legacy seed), an allowlist on system slugs MUST still
// strip it on export. Belt-and-suspenders next to the path-prefix branch.

import { describe, expect, it } from "vitest";
import {
  filterExportableSkills,
  type SkillNote,
} from "../agent-config-bundle";

describe("filterExportableSkills — allowlist defense-in-depth (K1)", () => {
  it("drops system-slug notes that lack the SKILLS_PREFIX (malformed row)", () => {
    const skills: SkillNote[] = [
      { path: "deep-read/SKILL.md", body: "leaked" },
      { path: "paper-search/SKILL.md", body: "leaked" },
      { path: "lit-triage/SKILL.md", body: "leaked" },
      { path: "synthesis/SKILL.md", body: "leaked" },
      { path: "my-notes/keepme.md", body: "user" },
    ];
    const out = filterExportableSkills(skills);
    expect(out.map((s) => s.path)).toEqual(["my-notes/keepme.md"]);
  });

  it("still drops properly-prefixed system slugs via the allowlist", () => {
    const skills: SkillNote[] = [
      { path: ".episteme/agents/skills/paper-search/SKILL.md", body: "sys" },
      { path: "my-notes/keepme.md", body: "user" },
    ];
    const out = filterExportableSkills(skills);
    expect(out.map((s) => s.path)).toEqual(["my-notes/keepme.md"]);
  });
});
