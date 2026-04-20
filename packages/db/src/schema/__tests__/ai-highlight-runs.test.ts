import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { aiHighlightRuns } from "../ai-highlight-runs";

describe("aiHighlightRuns schema", () => {
  const config = getTableConfig(aiHighlightRuns);

  it("has correct table name", () => {
    expect(config.name).toBe("ai_highlight_runs");
  });

  it("has all expected columns", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        "id",
        "document_id",
        "user_id",
        "instruction",
        "model_used",
        "status",
        "summary",
        "conversation_id",
        "created_at",
        "completed_at",
      ]),
    );
  });

  it("id is uuid primary key with default", () => {
    const col = config.columns.find((c) => c.name === "id");
    expect(col?.primary).toBe(true);
    expect(col?.columnType).toBe("PgUUID");
    expect(col?.hasDefault).toBe(true);
  });

  it("document_id is integer not null", () => {
    const col = config.columns.find((c) => c.name === "document_id");
    expect(col?.columnType).toBe("PgInteger");
    expect(col?.notNull).toBe(true);
  });

  it("user_id is text not null", () => {
    const col = config.columns.find((c) => c.name === "user_id");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
  });

  it("instruction is text not null", () => {
    const col = config.columns.find((c) => c.name === "instruction");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
  });

  it("model_used is text nullable", () => {
    const col = config.columns.find((c) => c.name === "model_used");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(false);
  });

  it("status is text not null", () => {
    const col = config.columns.find((c) => c.name === "status");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
  });

  it("summary is text nullable", () => {
    const col = config.columns.find((c) => c.name === "summary");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(false);
  });

  it("conversation_id is integer nullable", () => {
    const col = config.columns.find((c) => c.name === "conversation_id");
    expect(col?.columnType).toBe("PgInteger");
    expect(col?.notNull).toBe(false);
  });

  it("created_at is timestamptz not null with default", () => {
    const col = config.columns.find((c) => c.name === "created_at");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });

  it("completed_at is timestamp nullable", () => {
    const col = config.columns.find((c) => c.name === "completed_at");
    expect(col?.notNull).toBe(false);
  });

  it("document_id has foreign key to documents", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "document_id",
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });

  it("user_id has foreign key to user", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "user_id",
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });

  it("conversation_id has foreign key to agent_conversations", () => {
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "conversation_id",
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
  });

  it("has index on (document_id, created_at)", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "ai_highlight_runs_document_idx",
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(cols).toEqual(["document_id", "created_at"]);
  });
});
