import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { papersets } from "../papersets";

describe("papersets schema", () => {
  const config = getTableConfig(papersets);

  it("table named papersets", () => {
    expect(config.name).toBe("papersets");
  });

  it("has expected columns", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "library_id",
        "user_id",
        "folder_id",
        "prev_folder_id",
        "filename",
        "columns",
        "row_refs",
        "cell_grounding",
        "running_cells",
        "content",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("id is uuid pk with defaultRandom", () => {
    const id = config.columns.find((c) => c.name === "id")!;
    expect(id.primary).toBe(true);
    expect(id.dataType).toBe("string");
  });

  it("columns/row_refs/cell_grounding/running_cells are jsonb not null", () => {
    const cols = config.columns.find((c) => c.name === "columns")!;
    const rr = config.columns.find((c) => c.name === "row_refs")!;
    const cg = config.columns.find((c) => c.name === "cell_grounding")!;
    const rc = config.columns.find((c) => c.name === "running_cells")!;
    expect(cols.notNull).toBe(true);
    expect(rr.notNull).toBe(true);
    expect(cg.notNull).toBe(true);
    expect(rc.notNull).toBe(true);
  });
});
