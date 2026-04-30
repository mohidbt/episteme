import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { papers } from "../papers";

describe("papers schema — chandra columns", () => {
  const config = getTableConfig(papers);

  it("has chandra_status column", () => {
    const col = config.columns.find((c) => c.name === "chandra_status");
    expect(col).toBeDefined();
  });

  it("chandra_status is text not null with default 'pending'", () => {
    const col = config.columns.find((c) => c.name === "chandra_status");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
    expect(col?.default).toBe("pending");
  });

  it("has chandra_completed_at column", () => {
    const col = config.columns.find((c) => c.name === "chandra_completed_at");
    expect(col).toBeDefined();
  });

  it("chandra_completed_at is timestamptz nullable", () => {
    const col = config.columns.find((c) => c.name === "chandra_completed_at");
    expect(col?.columnType).toBe("PgTimestamp");
    expect(col?.notNull).toBe(false);
  });
});
