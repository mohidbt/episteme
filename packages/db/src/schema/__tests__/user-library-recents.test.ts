// GSD-96 R3 — RED.
//
// Edge cases this covers:
//  - table exists w/ all 4 columns
//  - PK is composite (user_id, kind, item_id) — prevents duplicate rows per item
//  - kind is text (CHECK is asserted in the migration test, not schema)
//  - opened_at timestamptz NOT NULL DEFAULT now()
//  - index on (user_id, opened_at) so recent-N reads are sub-ms
import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { userLibraryRecents } from "../user-library-recents";

describe("user_library_recents schema", () => {
  const config = getTableConfig(userLibraryRecents);

  it("has user_id, kind, item_id, opened_at columns", () => {
    const names = config.columns.map((c) => c.name).sort();
    expect(names).toEqual(["item_id", "kind", "opened_at", "user_id"]);
  });

  it("opened_at is timestamptz NOT NULL with default", () => {
    const col = config.columns.find((c) => c.name === "opened_at");
    expect(col?.columnType).toBe("PgTimestamp");
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });

  it("kind is text NOT NULL", () => {
    const col = config.columns.find((c) => c.name === "kind");
    expect(col?.columnType).toBe("PgText");
    expect(col?.notNull).toBe(true);
  });

  it("item_id is uuid NOT NULL", () => {
    const col = config.columns.find((c) => c.name === "item_id");
    expect(col?.columnType).toBe("PgUUID");
    expect(col?.notNull).toBe(true);
  });

  it("composite PK on (user_id, kind, item_id)", () => {
    const pk = config.primaryKeys[0];
    expect(pk).toBeDefined();
    const pkCols = pk!.columns.map((c) => c.name).sort();
    expect(pkCols).toEqual(["item_id", "kind", "user_id"]);
  });

  it("indexes (user_id, opened_at)", () => {
    const idx = config.indexes.find((i) => i.config.name === "user_library_recents_user_opened_idx");
    expect(idx).toBeDefined();
    const cols = idx!.config.columns.map((c) => (c as { name: string }).name);
    expect(cols).toContain("user_id");
    expect(cols).toContain("opened_at");
  });
});
