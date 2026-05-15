// A5: regression test pinning `filterExportableSkills` to an explicit
// allowlist of system-skill slugs (sourced from `services/agents/skills/*`).
// The previous implementation used a brittle path-substring check
// (`.episteme/agents/skills/...`) which would drop any personal skill that
// happened to share that prefix.

import { describe, expect, it } from "vitest";
import {
  filterExportableSkills,
  type SkillNote,
} from "../agent-config-bundle";

describe("filterExportableSkills — explicit system-slug allowlist (A5)", () => {
  it("drops a real system slug and keeps an unrelated user slug", () => {
    const skills: SkillNote[] = [
      { path: ".episteme/agents/skills/lit-triage/SKILL.md", body: "sys" },
      { path: "my-notes/my-custom-skill.md", body: "mine" },
    ];
    const out = filterExportableSkills(skills);
    const paths = out.map((s) => s.path);
    expect(paths).not.toContain(".episteme/agents/skills/lit-triage/SKILL.md");
    expect(paths).toContain("my-notes/my-custom-skill.md");
  });

  it("keeps a user slug even when path-prefixed like a system skill", () => {
    // Simulates the prior brittle behavior: a personal skill that happens to
    // live under `.episteme/agents/skills/...` must NOT be dropped — only
    // allowlisted system slugs are filtered.
    const skills: SkillNote[] = [
      { path: ".episteme/agents/skills/my-custom-skill/SKILL.md", body: "mine" },
    ];
    const out = filterExportableSkills(skills);
    expect(out.map((s) => s.path)).toEqual([
      ".episteme/agents/skills/my-custom-skill/SKILL.md",
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
});
