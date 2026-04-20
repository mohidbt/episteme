import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  userHighlights,
  highlightColorEnum,
  highlightSourceEnum,
} from "../user-highlights";

describe("userHighlights extensions schema", () => {
  const config = getTableConfig(userHighlights);

  it("has new columns: source, layer_id, comment, rects", () => {
    const colNames = config.columns.map((c) => c.name);
    expect(colNames).toContain("source");
    expect(colNames).toContain("layer_id");
    expect(colNames).toContain("comment");
    expect(colNames).toContain("rects");
  });

  it("source is not null with default 'user'", () => {
    const col = config.columns.find((c) => c.name === "source");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
    expect(col?.default).toBe("user");
  });

  it("layer_id is uuid and nullable", () => {
    const col = config.columns.find((c) => c.name === "layer_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.columnType).toBe("PgUUID");
  });

  it("comment is text and nullable", () => {
    const col = config.columns.find((c) => c.name === "comment");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.columnType).toBe("PgText");
  });

  it("rects is jsonb and nullable", () => {
    const col = config.columns.find((c) => c.name === "rects");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
    expect(col?.columnType).toBe("PgJsonb");
  });

  it("has index on layer_id", () => {
    const idxNames = config.indexes.map((i) => i.config.name);
    expect(idxNames).toContain("user_highlights_layer_idx");
  });

  it("highlightColorEnum includes 'amber'", () => {
    expect(highlightColorEnum.enumValues).toContain("amber");
  });

  it("highlightSourceEnum has values ['user', 'ai-auto']", () => {
    expect(highlightSourceEnum.enumValues).toEqual(["user", "ai-auto"]);
  });
});
