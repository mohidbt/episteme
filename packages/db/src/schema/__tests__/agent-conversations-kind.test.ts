import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentConversations } from "../agent-conversations";

describe("agentConversations.kind column", () => {
  const config = getTableConfig(agentConversations);

  it("has kind column", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("kind");
  });

  it("kind is text, not null, default 'chat'", () => {
    const col = config.columns.find((c) => c.name === "kind");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
    expect(col?.default).toBe("chat");
  });

  it("has index on (paper_id, kind)", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "agent_conversations_kind_idx",
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(cols).toEqual(["paper_id", "kind"]);
  });

  it("paper_id is uuid not null with FK to papers", () => {
    const col = config.columns.find((c) => c.name === "paper_id");
    expect(col?.columnType).toBe("PgUUID");
    expect(col?.notNull).toBe(true);
    const fk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === "paper_id",
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0]?.name).toBe("id");
    expect(fk?.onDelete).toBe("cascade");
  });
});
