import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentMessageMetadata } from "../agent-message-metadata";
import { agentThreadPapers } from "../agent-thread-papers";

function primaryKeyColumns(table: Parameters<typeof getTableConfig>[0]): string[] {
  const config = getTableConfig(table);
  expect(config.primaryKeys).toHaveLength(1);
  return config.primaryKeys[0].columns.map((column) => column.name);
}

describe("agent tenant-scoped primary keys", () => {
  it("scopes message metadata conflicts by user", () => {
    expect(primaryKeyColumns(agentMessageMetadata)).toEqual([
      "user_id",
      "thread_id",
      "message_id",
      "kind",
    ]);
  });

  it("scopes thread-paper conflicts by user", () => {
    expect(primaryKeyColumns(agentThreadPapers)).toEqual([
      "user_id",
      "thread_id",
      "paper_id",
    ]);
  });
});
