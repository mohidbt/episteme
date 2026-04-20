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

  it("has index on (document_id, kind)", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "agent_conversations_kind_idx",
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map((c) => ("name" in c ? c.name : undefined));
    expect(cols).toEqual(["document_id", "kind"]);
  });
});
