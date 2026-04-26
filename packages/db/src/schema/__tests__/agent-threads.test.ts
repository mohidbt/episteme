import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentThreads } from "../agent-threads";

describe("agentThreads table", () => {
  const config = getTableConfig(agentThreads);

  it("table name is agent_threads", () => {
    expect(config.name).toBe("agent_threads");
  });

  it("has user_id column, not null", () => {
    const col = config.columns.find((c) => c.name === "user_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.columnType).toBe("PgText");
  });

  it("has thread_id column, not null", () => {
    const col = config.columns.find((c) => c.name === "thread_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.columnType).toBe("PgText");
  });

  it("has composite primary key on (user_id, thread_id)", () => {
    const pk = config.primaryKeys[0];
    expect(pk).toBeDefined();
    const pkColNames = pk?.columns.map((c) => c.name);
    expect(pkColNames).toContain("user_id");
    expect(pkColNames).toContain("thread_id");
  });

  it("has status column with enum, default 'idle', not null", () => {
    const col = config.columns.find((c) => c.name === "status");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
    expect(col?.default).toBe("idle");
  });

  it("status enum includes all required values", () => {
    const col = config.columns.find((c) => c.name === "status");
    const enumValues = (col as unknown as { enumValues?: string[] }).enumValues;
    expect(enumValues).toContain("idle");
    expect(enumValues).toContain("running");
    expect(enumValues).toContain("awaiting_hitl");
    expect(enumValues).toContain("error");
  });

  it("has model_override column, nullable text", () => {
    const col = config.columns.find((c) => c.name === "model_override");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.columnType).toBe("PgText");
  });

  it("has title column, nullable text", () => {
    const col = config.columns.find((c) => c.name === "title");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  it("has skill column, nullable text", () => {
    const col = config.columns.find((c) => c.name === "skill");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  it("has last_message_at column, nullable timestamp", () => {
    const col = config.columns.find((c) => c.name === "last_message_at");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  it("has created_at with default", () => {
    const col = config.columns.find((c) => c.name === "created_at");
    expect(col).toBeDefined();
    expect(col?.hasDefault).toBe(true);
  });

  it("has updated_at with default", () => {
    const col = config.columns.find((c) => c.name === "updated_at");
    expect(col).toBeDefined();
    expect(col?.hasDefault).toBe(true);
  });
});
