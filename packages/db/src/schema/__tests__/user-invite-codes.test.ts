import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { userInviteCodes } from "../user-invite-codes";

describe("user_invite_codes schema", () => {
  const config = getTableConfig(userInviteCodes);

  it("table named user_invite_codes", () => {
    expect(config.name).toBe("user_invite_codes");
  });

  it("has expected columns", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "code",
        "owner_user_id",
        "consumed_by_user_id",
        "consumed_at",
        "created_at",
      ]),
    );
  });

  it("code is primary key text not null", () => {
    const code = config.columns.find((c) => c.name === "code")!;
    expect(code.primary).toBe(true);
    expect(code.notNull).toBe(true);
  });

  it("owner_user_id is not null; consumed_by_user_id is nullable", () => {
    const owner = config.columns.find((c) => c.name === "owner_user_id")!;
    const consumer = config.columns.find(
      (c) => c.name === "consumed_by_user_id",
    )!;
    expect(owner.notNull).toBe(true);
    expect(consumer.notNull).toBe(false);
  });

  it("has owner index", () => {
    const indexes = config.indexes.map((i) => i.config.name);
    expect(indexes).toContain("idx_user_invite_codes_owner");
  });
});
