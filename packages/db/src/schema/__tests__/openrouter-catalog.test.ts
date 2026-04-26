import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { openrouterCatalog } from "../openrouter-catalog";

describe("openrouterCatalog table", () => {
  const config = getTableConfig(openrouterCatalog);

  it("table name is openrouter_catalog", () => {
    expect(config.name).toBe("openrouter_catalog");
  });

  it("has model_id as primary key", () => {
    const col = config.columns.find((c) => c.name === "model_id");
    expect(col).toBeDefined();
    expect(col?.primary).toBe(true);
    expect(col?.columnType).toBe("PgText");
  });

  it("has payload column, jsonb, not null", () => {
    const col = config.columns.find((c) => c.name === "payload");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.columnType).toBe("PgJsonb");
  });

  it("has fetched_at column with default", () => {
    const col = config.columns.find((c) => c.name === "fetched_at");
    expect(col).toBeDefined();
    expect(col?.hasDefault).toBe(true);
  });
});
