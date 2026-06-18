import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { userOpenrouterKeys } from "../user-openrouter-keys";

describe("user_openrouter_keys schema", () => {
  const config = getTableConfig(userOpenrouterKeys);

  it("table named user_openrouter_keys", () => {
    expect(config.name).toBe("user_openrouter_keys");
  });

  it("has expected columns", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "user_id",
        "or_key_hash",
        "or_key_encrypted",
        "limit_usd",
        "limit_reset",
        "tier",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("user_id is primary key, not null", () => {
    const col = config.columns.find((c) => c.name === "user_id")!;
    expect(col.primary).toBe(true);
    expect(col.notNull).toBe(true);
    expect(col.columnType).toBe("PgText");
  });

  it("or_key_hash and or_key_encrypted are not null text", () => {
    const hash = config.columns.find((c) => c.name === "or_key_hash")!;
    const enc = config.columns.find((c) => c.name === "or_key_encrypted")!;
    expect(hash.notNull).toBe(true);
    expect(hash.columnType).toBe("PgText");
    expect(enc.notNull).toBe(true);
    expect(enc.columnType).toBe("PgText");
  });

  it("limit_usd is numeric not null with default", () => {
    const col = config.columns.find((c) => c.name === "limit_usd")!;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.columnType).toBe("PgNumeric");
  });

  it("limit_reset is nullable text", () => {
    const col = config.columns.find((c) => c.name === "limit_reset")!;
    expect(col.notNull).toBe(false);
    expect(col.columnType).toBe("PgText");
  });

  it("tier is not null text with default", () => {
    const col = config.columns.find((c) => c.name === "tier")!;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
  });

  it("created_at and updated_at have defaults", () => {
    const c = config.columns.find((x) => x.name === "created_at")!;
    const u = config.columns.find((x) => x.name === "updated_at")!;
    expect(c.hasDefault).toBe(true);
    expect(u.hasDefault).toBe(true);
  });

  it("user_id cascades to user via FK", () => {
    const userIdCol = config.columns.find((c) => c.name === "user_id")!;
    // Drizzle exposes FK refs through the columns' `getSQLType` indirectly;
    // most reliable check is the table's foreign keys collection.
    const fks = config.foreignKeys;
    expect(fks.length).toBeGreaterThan(0);
    const fk = fks[0]!.reference();
    expect(fk.foreignTable[Symbol.for("drizzle:Name") as never]).toBe("user");
    expect(fk.columns.map((c) => c.name)).toContain(userIdCol.name);
    // onDelete metadata is exposed as `onDelete` on the FK builder.
    expect(fks[0]!.onDelete).toBe("cascade");
  });
});
