import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { noteRevisions } from "../note-revisions";

describe("noteRevisions agent-author columns", () => {
  const config = getTableConfig(noteRevisions);

  it("revision_reason enum includes 'agent-write'", () => {
    const col = config.columns.find((c) => c.name === "reason");
    // PgEnumColumn stores enum values on the underlying enum type
    const enumValues = (col as unknown as { enumValues?: string[] }).enumValues;
    expect(enumValues).toContain("agent-write");
  });

  it("has author_kind column of type PgEnumColumn, default 'user', not null", () => {
    const col = config.columns.find((c) => c.name === "author_kind");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
    // enum default value
    expect(col?.default).toBe("user");
  });

  it("has agent_invocation_id column, nullable uuid", () => {
    const col = config.columns.find((c) => c.name === "agent_invocation_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.columnType).toBe("PgUUID");
  });

  it("has agent_skill column, nullable text", () => {
    const col = config.columns.find((c) => c.name === "agent_skill");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.columnType).toBe("PgText");
  });
});
