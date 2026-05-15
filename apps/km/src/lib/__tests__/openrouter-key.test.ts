// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the BYOK helper so we can simulate user-has-key / no-key without DB.
vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

import { getDecryptedApiKey } from "@episteme/auth/byok";
import {
  getOrApiKey,
  OpenRouterKeyMissing,
} from "../openrouter-key";

const ORIGINAL_ENV = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  vi.mocked(getDecryptedApiKey).mockReset();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_ENV;
});

describe("getOrApiKey", () => {
  it("returns the user's decrypted BYOK key when present", async () => {
    vi.mocked(getDecryptedApiKey).mockResolvedValue("user-byok-key");
    process.env.OPENROUTER_API_KEY = "env-fallback";

    const key = await getOrApiKey("user_123");

    expect(key).toBe("user-byok-key");
    expect(getDecryptedApiKey).toHaveBeenCalledWith("user_123");
  });

  it("falls back to OPENROUTER_API_KEY when user has no BYOK row", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    process.env.OPENROUTER_API_KEY = "server-env-key";

    const key = await getOrApiKey("user_123");

    expect(key).toBe("server-env-key");
  });

  it("falls back to OPENROUTER_API_KEY when userId is null (guest)", async () => {
    process.env.OPENROUTER_API_KEY = "server-env-key";

    const key = await getOrApiKey(null);

    expect(key).toBe("server-env-key");
    // BYOK lookup must NOT happen for null userId.
    expect(getDecryptedApiKey).not.toHaveBeenCalled();
  });

  it("throws OpenRouterKeyMissing when neither BYOK nor env is set", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    delete process.env.OPENROUTER_API_KEY;

    await expect(getOrApiKey("user_123")).rejects.toBeInstanceOf(
      OpenRouterKeyMissing,
    );
  });

  it("throws OpenRouterKeyMissing for guest with no env", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(getOrApiKey(null)).rejects.toBeInstanceOf(OpenRouterKeyMissing);
  });
});
