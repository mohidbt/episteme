import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the DB module so we control the row-lookup result without touching Postgres.
// WHY: this test isolates getUserS2Key's env-fallback branch — DB connectivity
// is a separate concern covered by other suites.
let dbResult: Array<{ encryptedKey: string }> = [];

vi.mock("@episteme/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(dbResult),
  };
  return { db: chain };
});

vi.mock("@episteme/db/schema", () => ({
  userApiKeys: {
    encryptedKey: "encryptedKey",
    userId: "userId",
    providerType: "providerType",
  },
}));

vi.mock("../encryption", () => ({
  decrypt: (v: string) => `decrypted:${v}`,
}));

import { getUserS2Key } from "../byok";

describe("getUserS2Key env fallback", () => {
  beforeEach(() => {
    dbResult = [];
    delete process.env.SEMANTIC_SCHOLAR_API_KEY;
  });

  it("returns env SEMANTIC_SCHOLAR_API_KEY when no DB row exists", async () => {
    process.env.SEMANTIC_SCHOLAR_API_KEY = "env-s2-key";
    dbResult = [];

    const key = await getUserS2Key("user-1");

    expect(key).toBe("env-s2-key");
  });

  it("returns null when no DB row and no env var", async () => {
    dbResult = [];

    const key = await getUserS2Key("user-1");

    expect(key).toBeNull();
  });

  it("returns decrypted DB key when row exists (env ignored)", async () => {
    process.env.SEMANTIC_SCHOLAR_API_KEY = "env-s2-key";
    dbResult = [{ encryptedKey: "cipher" }];

    const key = await getUserS2Key("user-1");

    expect(key).toBe("decrypted:cipher");
  });
});
