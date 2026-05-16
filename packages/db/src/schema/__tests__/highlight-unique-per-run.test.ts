import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { paperHighlights } from "../paper-highlights";
import { userHighlights } from "../user-highlights";

describe("paperHighlights run-scoped uniqueness (Round G)", () => {
  const config = getTableConfig(paperHighlights);

  it("declares partial unique index paper_highlights_run_page_bbox_uk", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "paper_highlights_run_page_bbox_uk",
    );
    expect(idx, "missing unique index").toBeDefined();
    expect(idx?.config.unique).toBe(true);
    // Partial: only enforced when run_id IS NOT NULL
    expect(idx?.config.where).toBeDefined();
  });
});

describe("userHighlights layer-scoped uniqueness (Round G)", () => {
  const config = getTableConfig(userHighlights);

  it("declares partial unique index user_highlights_layer_page_offsets_uk", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "user_highlights_layer_page_offsets_uk",
    );
    expect(idx, "missing unique index").toBeDefined();
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
  });

  it("unique index covers (layer_id, page_number, start_offset, end_offset)", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "user_highlights_layer_page_offsets_uk",
    );
    const colNames = idx?.config.columns.map((c) =>
      typeof c === "object" && "name" in c ? (c as { name: string }).name : String(c),
    );
    expect(colNames).toEqual([
      "layer_id",
      "page_number",
      "start_offset",
      "end_offset",
    ]);
  });
});
