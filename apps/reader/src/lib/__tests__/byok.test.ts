import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db and decrypt before importing the module under test
vi.mock("@episteme/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@episteme/auth/encryption", () => ({ decrypt: vi.fn() }));

import { db } from "@episteme/db";
import { decrypt } from "@episteme/auth/encryption";
import { getUserS2Key, getDecryptedChandraKey } from "@episteme/auth/byok";

const mockDecrypt = vi.mocked(decrypt);

function mockSelect(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(db.select).mockReturnValue(chain as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserS2Key", () => {
  it("returns null when no row exists", async () => {
    mockSelect([]);
    const result = await getUserS2Key("user-1");
    expect(result).toBeNull();
  });

  it("returns decrypted key when row exists with providerType references", async () => {
    mockSelect([{ encryptedKey: "encrypted-blob" }]);
    mockDecrypt.mockReturnValue("my-s2-api-key");

    const result = await getUserS2Key("user-1");

    expect(mockDecrypt).toHaveBeenCalledWith("encrypted-blob");
    expect(result).toBe("my-s2-api-key");
  });
});

describe("getDecryptedChandraKey", () => {
  it("returns null when no row exists", async () => {
    mockSelect([]);
    const result = await getDecryptedChandraKey("user-1");
    expect(result).toBeNull();
  });

  it("returns decrypted key when a chandra ocr row exists", async () => {
    mockSelect([{ encryptedKey: "chandra-encrypted" }]);
    mockDecrypt.mockReturnValue("chandra-secret");

    const result = await getDecryptedChandraKey("user-1");

    expect(mockDecrypt).toHaveBeenCalledWith("chandra-encrypted");
    expect(result).toBe("chandra-secret");
  });
});
