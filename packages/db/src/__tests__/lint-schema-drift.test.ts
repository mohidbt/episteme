import { describe, expect, it } from "vitest";
import {
  extractRiskyDDL,
  findViolations,
  hasMatchingCheck,
  shouldSkipLint,
} from "../../scripts/lint-schema-drift";

describe("extractRiskyDDL", () => {
  it("extracts ADD COLUMN", () => {
    const sql = `ALTER TABLE foo ADD COLUMN bar text NOT NULL;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      line: 1,
      kind: "ADD COLUMN",
      table: "foo",
      name: "bar",
    });
  });

  it("extracts SET NOT NULL", () => {
    const sql = `ALTER TABLE "papers" ALTER COLUMN "storage_url" SET NOT NULL;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("SET NOT NULL");
    expect(hits[0].table).toBe("papers");
    expect(hits[0].name).toBe("storage_url");
  });

  it("extracts DROP COLUMN", () => {
    const sql = `alter table foo drop column bar;`;
    const hits = extractRiskyDDL(sql);
    expect(hits[0]).toMatchObject({ kind: "DROP COLUMN", table: "foo", name: "bar" });
  });

  it("extracts ADD CONSTRAINT with constraint name", () => {
    const sql = `ALTER TABLE foo ADD CONSTRAINT foo_pkey PRIMARY KEY (id);`;
    const hits = extractRiskyDDL(sql);
    expect(hits[0]).toMatchObject({
      kind: "ADD CONSTRAINT",
      table: "foo",
      name: "foo_pkey",
    });
  });

  it("extracts ALTER COLUMN SET DATA TYPE", () => {
    const sql = `ALTER TABLE foo ALTER COLUMN bar SET DATA TYPE bigint;`;
    const hits = extractRiskyDDL(sql);
    expect(hits[0]).toMatchObject({
      kind: "ALTER COLUMN TYPE",
      table: "foo",
      name: "bar",
    });
  });

  it("extracts ALTER COLUMN TYPE (postgres short form)", () => {
    const sql = `ALTER TABLE foo ALTER COLUMN bar TYPE bigint;`;
    const hits = extractRiskyDDL(sql);
    expect(hits[0]).toMatchObject({
      kind: "ALTER COLUMN TYPE",
      table: "foo",
      name: "bar",
    });
  });

  it("returns empty for non-DDL (INSERT/UPDATE only)", () => {
    const sql = `
      INSERT INTO foo (id, bar) VALUES (1, 'x');
      UPDATE foo SET bar = 'y' WHERE id = 1;
    `;
    expect(extractRiskyDDL(sql)).toEqual([]);
  });

  it("reports line numbers", () => {
    const sql = `-- header\n-- another\nALTER TABLE foo ADD COLUMN bar text;`;
    const hits = extractRiskyDDL(sql);
    expect(hits[0].line).toBe(3);
  });

  it("extracts DDL split across multiple lines", () => {
    const sql = `ALTER TABLE foo\n  ADD COLUMN bar text NOT NULL;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "ADD COLUMN",
      table: "foo",
      name: "bar",
    });
  });

  it("extracts schema-qualified table names (public.foo)", () => {
    const sql = `ALTER TABLE public.foo ADD COLUMN bar text;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "ADD COLUMN",
      table: "foo",
      name: "bar",
    });
  });

  it("extracts schema-qualified quoted table names", () => {
    const sql = `ALTER TABLE "public"."foo" ADD COLUMN "bar" text;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ table: "foo", name: "bar" });
  });

  it("ignores risky DDL inside line comments", () => {
    const sql = `-- ALTER TABLE foo ADD COLUMN bar int\nSELECT 1;`;
    expect(extractRiskyDDL(sql)).toEqual([]);
  });

  it("ignores risky DDL inside block comments", () => {
    const sql = `/* ALTER TABLE foo ADD COLUMN bar int */\nSELECT 1;`;
    expect(extractRiskyDDL(sql)).toEqual([]);
  });

  it("ignores risky DDL inside single-quoted strings", () => {
    const sql = `INSERT INTO log (msg) VALUES ('ALTER TABLE foo ADD COLUMN bar int');`;
    expect(extractRiskyDDL(sql)).toEqual([]);
  });

  it("extracts all clauses in a multi-clause ALTER TABLE", () => {
    const sql = `ALTER TABLE foo ADD COLUMN a int, ADD COLUMN b int;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.name).sort()).toEqual(["a", "b"]);
    expect(hits.every((h) => h.table === "foo" && h.kind === "ADD COLUMN")).toBe(
      true,
    );
  });

  it("does not match DDL hidden in a comment trailing real SQL", () => {
    const sql = `SELECT 1; -- ALTER TABLE foo DROP COLUMN bar`;
    expect(extractRiskyDDL(sql)).toEqual([]);
  });

  it("handles block comments preserving line offsets", () => {
    const sql = `/*\nignored\n*/\nALTER TABLE foo ADD COLUMN bar int;`;
    const hits = extractRiskyDDL(sql);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
  });
});

describe("hasMatchingCheck", () => {
  const schemaSrc = `
    'foo.bar_exists'::text as check_name,
    'foo.bar_not_null'::text as check_name,
    'baz.qux_exists'::text as check_name,
  `;

  it("matches when table and column appear in a check_name", () => {
    expect(hasMatchingCheck(schemaSrc, "foo", "bar")).toBe(true);
  });

  it("does not match when column missing", () => {
    expect(hasMatchingCheck(schemaSrc, "foo", "missing")).toBe(false);
  });

  it("does not match when table missing", () => {
    expect(hasMatchingCheck(schemaSrc, "nope", "bar")).toBe(false);
  });

  it("matches constraint names", () => {
    const src = `'foo.foo_pkey_exists'::text as check_name,`;
    expect(hasMatchingCheck(src, "foo", "foo_pkey")).toBe(true);
  });
});

describe("findViolations", () => {
  const schemaSrc = `'foo.bar_exists'::text as check_name,`;

  it("returns no violations when all risky DDLs covered", () => {
    const files = [
      { path: "0030_add.sql", sql: `ALTER TABLE foo ADD COLUMN bar text;` },
    ];
    expect(findViolations(files, schemaSrc)).toEqual([]);
  });

  it("returns violation when check missing", () => {
    const files = [
      { path: "0030_add.sql", sql: `ALTER TABLE foo ADD COLUMN missing text;` },
    ];
    const violations = findViolations(files, schemaSrc);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: "0030_add.sql",
      line: 1,
      table: "foo",
      name: "missing",
    });
  });

  it("returns no violations for non-DDL files", () => {
    const files = [
      { path: "0030_data.sql", sql: `INSERT INTO foo (id) VALUES (1);` },
    ];
    expect(findViolations(files, schemaSrc)).toEqual([]);
  });

  it("reports multiple violations across files", () => {
    const files = [
      { path: "0030.sql", sql: `ALTER TABLE alpha ADD COLUMN col_x text;` },
      { path: "0031.sql", sql: `ALTER TABLE beta DROP COLUMN col_y;` },
    ];
    expect(findViolations(files, schemaSrc)).toHaveLength(2);
  });
});

describe("shouldSkipLint", () => {
  it("returns true when PR body contains predeploy-lint:skip token", () => {
    expect(shouldSkipLint("predeploy-lint:skip foo")).toBe(true);
  });

  it("returns false when PR body is undefined or lacks token", () => {
    expect(shouldSkipLint(undefined)).toBe(false);
    expect(shouldSkipLint("")).toBe(false);
    expect(shouldSkipLint("some unrelated PR description")).toBe(false);
  });
});
