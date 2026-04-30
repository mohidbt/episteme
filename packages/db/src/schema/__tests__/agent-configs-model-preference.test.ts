import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agentConfigs } from "../agent-configs";

describe("agentConfigs.modelPreference column", () => {
  const config = getTableConfig(agentConfigs);

  it("has model_preference column", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("model_preference");
  });

  it("model_preference is PgText (not enum), not null, default 'google/gemma-4-26b-a4b-it'", () => {
    const col = config.columns.find((c) => c.name === "model_preference");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
    expect(col?.default).toBe("google/gemma-4-26b-a4b-it");
  });
});
