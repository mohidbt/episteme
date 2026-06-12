import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import {
  drizzleTagFromFile,
  mapCriticalCheckRows,
  runJournalChecks,
} from "../schema-drift";

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

describe("schema drift critical check mapping", () => {
  it("includes new user_highlights paper_id checks", () => {
    const checks = mapCriticalCheckRows([
      { check_name: "user_highlights.paper_id_exists", ok: true, details: "x" },
      { check_name: "user_highlights.paper_id_not_null", ok: true, details: "x" },
      { check_name: "user_highlights.user_paper_index_exists", ok: false, details: "missing" },
    ]);
    expect(checks.map((c) => c.name)).toEqual([
      "user_highlights.paper_id_exists",
      "user_highlights.paper_id_not_null",
      "user_highlights.user_paper_index_exists",
    ]);
    expect(checks.every((c) => c.ok)).toBe(false);
    expect(checks.find((c) => c.name === "user_highlights.user_paper_index_exists")?.details).toBe(
      "missing",
    );
  });

  it("includes user_library_recents FK check", () => {
    const checks = mapCriticalCheckRows([
      {
        check_name: "user_library_recents.user_library_recents_user_id_user_id_fk",
        ok: true,
        details: "ok",
      },
    ]);
    expect(checks.map((c) => c.name)).toContain(
      "user_library_recents.user_library_recents_user_id_user_id_fk",
    );
  });

  it("queries the user_library_recents FK via pg_constraint (predeploy_ro-visible)", async () => {
    // Regression: information_schema.table_constraints hides FK rows from roles
    // with only SELECT (Postgres docs). predeploy_ro hits exactly that and the
    // FK check went red despite the constraint being present in prod. Source
    // SQL must use pg_constraint so the check is visibility-robust.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../schema-drift.ts"),
      "utf8",
    );
    const fkSectionMatch = src.match(
      /user_library_recents_user_id_user_id_fk[\s\S]{0,800}/,
    );
    expect(fkSectionMatch).not.toBeNull();
    expect(fkSectionMatch![0]).toContain("from pg_constraint");
    expect(fkSectionMatch![0]).not.toMatch(/from information_schema\.table_constraints/);
  });

  it("includes papers storage_url contract checks", () => {
    const checks = mapCriticalCheckRows([
      { check_name: "papers.storage_url_present_for_parse_active_rows", ok: false, details: "2 rows" },
      { check_name: "papers.storage_url_canonical_shape", ok: true, details: "ok" },
    ]);
    expect(checks.map((c) => c.name)).toContain("papers.storage_url_present_for_parse_active_rows");
    expect(checks.map((c) => c.name)).toContain("papers.storage_url_canonical_shape");
    expect(checks[0]?.details).toBe("2 rows");
  });
});
