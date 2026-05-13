import { describe, it, expect } from "vitest";
import { normalizeDump } from "../snapshot-normalize.js";

describe("normalizeDump", () => {
  it("strips -- line comments", () => {
    const input = [
      "-- PostgreSQL database dump",
      "CREATE TABLE foo (id int);",
      "-- end",
    ].join("\n");
    expect(normalizeDump(input)).toBe("CREATE TABLE foo (id int);\n");
  });

  it("strips blank lines and trailing whitespace", () => {
    const input = "CREATE TABLE foo (id int);   \n\n\nCREATE INDEX i ON foo(id);\t\n";
    expect(normalizeDump(input)).toBe(
      "CREATE TABLE foo (id int);\nCREATE INDEX i ON foo(id);\n",
    );
  });

  it("strips SET ...; lines emitted by pg_dump", () => {
    const input = [
      "SET statement_timeout = 0;",
      "SET client_encoding = 'UTF8';",
      "SET search_path = public;",
      "CREATE TABLE foo (id int);",
    ].join("\n");
    expect(normalizeDump(input)).toBe("CREATE TABLE foo (id int);\n");
  });

  it("preserves table defs, indexes, constraints, functions, triggers", () => {
    const input = [
      "CREATE TABLE foo (",
      "    id integer NOT NULL,",
      "    name text",
      ");",
      "CREATE INDEX foo_name_idx ON foo USING btree (name);",
      "ALTER TABLE ONLY foo ADD CONSTRAINT foo_pkey PRIMARY KEY (id);",
      "CREATE FUNCTION bar() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;",
      "CREATE TRIGGER t BEFORE INSERT ON foo FOR EACH ROW EXECUTE FUNCTION bar();",
    ].join("\n");
    const out = normalizeDump(input);
    expect(out).toContain("CREATE TABLE foo (");
    expect(out).toContain("    id integer NOT NULL,");
    expect(out).toContain("CREATE INDEX foo_name_idx ON foo USING btree (name);");
    expect(out).toContain("ADD CONSTRAINT foo_pkey PRIMARY KEY (id);");
    expect(out).toContain("CREATE FUNCTION bar()");
    expect(out).toContain("CREATE TRIGGER t");
  });

  it("is idempotent", () => {
    const input = [
      "-- comment",
      "SET timezone = 'UTC';",
      "",
      "CREATE TABLE foo (id int);   ",
      "",
      "CREATE INDEX i ON foo(id);",
    ].join("\n");
    const once = normalizeDump(input);
    const twice = normalizeDump(once);
    expect(twice).toBe(once);
  });

  it("returns empty string for input that normalizes to nothing", () => {
    const input = "-- only comments\nSET a = 1;\n\n";
    expect(normalizeDump(input)).toBe("");
  });

  it("does not strip lines that merely contain 'SET' mid-statement", () => {
    const input = "ALTER TABLE foo ALTER COLUMN x SET NOT NULL;";
    expect(normalizeDump(input)).toBe(
      "ALTER TABLE foo ALTER COLUMN x SET NOT NULL;\n",
    );
  });

  it("preserves SET inside $$ function bodies", () => {
    const input = [
      "SET search_path = public;",
      "CREATE FUNCTION f() RETURNS void AS $$",
      "BEGIN",
      "  SET search_path = public;",
      "  PERFORM 1;",
      "END",
      "$$ LANGUAGE plpgsql;",
    ].join("\n");
    const out = normalizeDump(input);
    expect(out).not.toMatch(/^SET search_path = public;$/m);
    expect(out).toContain("  SET search_path = public;");
    expect(out).toContain("CREATE FUNCTION f()");
  });

  it("preserves SET inside named $function$ delimited bodies", () => {
    const input = [
      "SET statement_timeout = 0;",
      "CREATE FUNCTION g() RETURNS void AS $function$",
      "BEGIN",
      "  SET ROLE admin;",
      "END",
      "$function$ LANGUAGE plpgsql;",
    ].join("\n");
    const out = normalizeDump(input);
    expect(out).not.toContain("SET statement_timeout = 0;");
    expect(out).toContain("  SET ROLE admin;");
  });

  it("only strips top-level SETs across multiple function bodies", () => {
    const input = [
      "SET client_encoding = 'UTF8';",
      "CREATE FUNCTION a() RETURNS void AS $$",
      "BEGIN SET search_path = public; END",
      "$$ LANGUAGE plpgsql;",
      "SET timezone = 'UTC';",
      "CREATE FUNCTION b() RETURNS void AS $body$",
      "BEGIN SET search_path = audit; END",
      "$body$ LANGUAGE plpgsql;",
      "SET role = postgres;",
    ].join("\n");
    const out = normalizeDump(input);
    expect(out).not.toContain("SET client_encoding");
    expect(out).not.toContain("SET timezone");
    expect(out).not.toMatch(/^SET role = postgres;$/m);
    expect(out).toContain("BEGIN SET search_path = public; END");
    expect(out).toContain("BEGIN SET search_path = audit; END");
  });
});
