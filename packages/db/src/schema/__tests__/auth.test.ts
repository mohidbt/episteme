import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { user } from "../auth";

describe("user schema", () => {
  const config = getTableConfig(user);

  it("has is_anonymous column", () => {
    const col = config.columns.find((c) => c.name === "is_anonymous");
    expect(col).toBeDefined();
  });

  it("is_anonymous is boolean, not null, defaults to false", () => {
    const col = config.columns.find((c) => c.name === "is_anonymous");
    expect(col?.dataType).toBe("boolean");
    expect(col?.notNull).toBe(true);
    expect(col?.default).toBe(false);
  });
});
