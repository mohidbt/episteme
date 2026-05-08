import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { drizzleTagFromFile, runJournalChecks } from "../schema-drift";

function setupFixture(tags: string[], journalTags = tags): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "schema-drift-"));
  const drizzleDir = join(root, "packages/db/drizzle");
  const metaDir = join(drizzleDir, "meta");
  mkdirSync(metaDir, { recursive: true });

  for (const tag of tags) {
    writeFileSync(join(drizzleDir, `${tag}.sql`), "-- fixture\n");
  }

  writeFileSync(
    join(metaDir, "_journal.json"),
    JSON.stringify(
      {
        entries: journalTags.map((tag, idx) => ({ idx, tag })),
      },
      null,
      2,
    ),
  );

  return { root };
}

describe("schema drift journal checks", () => {
  it("passes when journal tags match migration files", () => {
    const fixture = setupFixture(["0000_init", "0001_add_col"]);
    try {
      const result = runJournalChecks({ repoRoot: fixture.root });
      expect(result.ok).toBe(true);
      expect(result.latestTag).toBe("0001_add_col");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails when migration file is missing from journal", () => {
    const fixture = setupFixture(["0000_init", "0001_add_col"], ["0000_init"]);
    try {
      const result = runJournalChecks({ repoRoot: fixture.root });
      expect(result.ok).toBe(false);
      expect(result.checks.find((check) => check.name === "journal_matches_migration_files")?.ok).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("extracts drizzle tag from sql filename", () => {
    expect(drizzleTagFromFile("0029_document_references_paper_compat.sql")).toBe(
      "0029_document_references_paper_compat",
    );
    expect(drizzleTagFromFile("README.md")).toBeNull();
  });
});
