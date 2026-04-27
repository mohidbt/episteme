/**
 * Tests for the testable helpers exported by check-skill-addition.ts.
 *
 * Run with:
 *   node --test --import tsx scripts/check-skill-addition.test.ts
 *
 * The script itself (the integration gate) is exercised by CI in km-e2e.yml.
 * These helpers are unit-tested here so the gate's correctness is decoupled
 * from a running FastAPI service.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffsEqual,
  fixtureSkillContent,
  isFixturePathInsideSkillsDir,
  fixtureCollidesWithExistingSkill,
} from "./check-skill-addition.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("diffsEqual: identical strings compare equal", () => {
  assert.equal(diffsEqual("a\nb", "a\nb"), true);
});

test("diffsEqual: empty vs empty", () => {
  assert.equal(diffsEqual("", ""), true);
});

test("diffsEqual: differing strings compare unequal", () => {
  assert.equal(diffsEqual("a\nb", "a\nc"), false);
});

test("diffsEqual: trailing whitespace ignored", () => {
  assert.equal(diffsEqual("a\nb\n", "a\nb"), true);
});

test("fixtureSkillContent: includes required frontmatter fields", () => {
  const text = fixtureSkillContent();
  assert.match(text, /^---\n/);
  assert.match(text, /\nname: /);
  assert.match(text, /\ndescription: /);
  assert.match(text, /\ntools: /);
  assert.match(text, /\nsubagents: /);
  assert.match(text, /\nrequire_approval: /);
  assert.match(text, /\n---\n/);
});

test("isFixturePathInsideSkillsDir: rejects paths outside skills/", () => {
  assert.equal(
    isFixturePathInsideSkillsDir("services/agents/skills/fixture-skill"),
    true,
  );
  assert.equal(
    isFixturePathInsideSkillsDir("services/agents/fixture-skill"),
    false,
  );
  assert.equal(
    isFixturePathInsideSkillsDir("services/agents/skills/../fixture-skill"),
    false,
  );
});

test("fixtureCollidesWithExistingSkill: detects collision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-collide-"));
  try {
    await mkdir(join(dir, "existing"), { recursive: true });
    await writeFile(join(dir, "existing", "SKILL.md"), "---\n---\n");
    assert.equal(fixtureCollidesWithExistingSkill(dir, "existing"), true);
    assert.equal(fixtureCollidesWithExistingSkill(dir, "novel-name"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
