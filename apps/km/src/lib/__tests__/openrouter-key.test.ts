// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the BYOK helper so we can simulate user-has-key / no-key without DB.
vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

// Mock the managed-bucket helpers so we can simulate row-present /
// row-missing / lazy-provision flows without DB.
vi.mock("../user-bucket-store", () => ({
  loadUserBucket: vi.fn(),
  insertUserBucketIfMissing: vi.fn(),
}));

vi.mock("../openrouter-provisioning", () => ({
  createUserBucket: vi.fn(),
  getUserBucketUsage: vi.fn(),
  patchUserBucket: vi.fn(),
}));

import { getDecryptedApiKey } from "@episteme/auth/byok";
import {
  loadUserBucket,
  insertUserBucketIfMissing,
} from "../user-bucket-store";
import { createUserBucket } from "../openrouter-provisioning";
import {
  getOrApiKey,
  OpenRouterKeyMissing,
  OpenRouterTrialExhausted,
} from "../openrouter-key";

const ORIGINAL_ENV = process.env.OPENROUTER_API_KEY;
const ORIGINAL_PROV = process.env.OPENROUTER_PROVISIONING_KEY;

beforeEach(() => {
  vi.mocked(getDecryptedApiKey).mockReset();
  vi.mocked(loadUserBucket).mockReset();
  vi.mocked(insertUserBucketIfMissing).mockReset();
  vi.mocked(createUserBucket).mockReset();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_ENV;
  if (ORIGINAL_PROV === undefined) delete process.env.OPENROUTER_PROVISIONING_KEY;
  else process.env.OPENROUTER_PROVISIONING_KEY = ORIGINAL_PROV;
});

describe("getOrApiKey — resolver order", () => {
  it("returns the user's decrypted BYOK key when present (BYOK wins)", async () => {
    vi.mocked(getDecryptedApiKey).mockResolvedValue("user-byok-key");
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "managed-key",
      hash: "h_abc",
    });
    process.env.OPENROUTER_API_KEY = "env-fallback";

    const key = await getOrApiKey("user_123");

    expect(key).toBe("user-byok-key");
    expect(getDecryptedApiKey).toHaveBeenCalledWith("user_123");
    // Resolver short-circuits on BYOK; managed bucket lookup never runs.
    expect(loadUserBucket).not.toHaveBeenCalled();
  });

  it("returns the managed bucket's runtime key when BYOK absent + bucket row exists", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    vi.mocked(loadUserBucket).mockResolvedValue({
      runtimeKey: "managed-runtime-key",
      hash: "h_user_123",
    });
    process.env.OPENROUTER_PROVISIONING_KEY = "prov-key";
    process.env.OPENROUTER_API_KEY = "env-fallback";

    const key = await getOrApiKey("user_123");

    expect(key).toBe("managed-runtime-key");
    // Bucket already present → no provisioning call.
    expect(createUserBucket).not.toHaveBeenCalled();
    expect(insertUserBucketIfMissing).not.toHaveBeenCalled();
  });

  it("lazy-provisions a managed bucket when BYOK absent + bucket row missing", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    // First load → miss; after provision + insert → hit on re-read.
    vi.mocked(loadUserBucket)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        runtimeKey: "fresh-runtime-key",
        hash: "h_user_123",
      });
    vi.mocked(createUserBucket).mockResolvedValue({
      key: "fresh-runtime-key",
      hash: "h_user_123",
    });
    vi.mocked(insertUserBucketIfMissing).mockResolvedValue(true);
    process.env.OPENROUTER_PROVISIONING_KEY = "prov-key";

    const key = await getOrApiKey("user_123");

    expect(key).toBe("fresh-runtime-key");
    expect(createUserBucket).toHaveBeenCalledWith("user_123");
    expect(insertUserBucketIfMissing).toHaveBeenCalledWith({
      userId: "user_123",
      runtimeKey: "fresh-runtime-key",
      hash: "h_user_123",
    });
  });

  it("on race (concurrent provision), re-reads the row inserted by the winner", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    vi.mocked(loadUserBucket)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        runtimeKey: "winner-runtime-key",
        hash: "h_winner",
      });
    vi.mocked(createUserBucket).mockResolvedValue({
      key: "loser-runtime-key",
      hash: "h_loser",
    });
    // Our INSERT lost the race — returns false (conflict, no insert).
    vi.mocked(insertUserBucketIfMissing).mockResolvedValue(false);
    process.env.OPENROUTER_PROVISIONING_KEY = "prov-key";

    const key = await getOrApiKey("user_123");

    // Resolver must return the winner's key from the post-conflict re-read,
    // not the just-provisioned loser key.
    expect(key).toBe("winner-runtime-key");
  });

  it("falls back to env OPENROUTER_API_KEY for guest (userId null)", async () => {
    process.env.OPENROUTER_API_KEY = "server-env-key";

    const key = await getOrApiKey(null);

    expect(key).toBe("server-env-key");
    expect(getDecryptedApiKey).not.toHaveBeenCalled();
    expect(loadUserBucket).not.toHaveBeenCalled();
    expect(createUserBucket).not.toHaveBeenCalled();
  });

  it("throws OpenRouterKeyMissing for guest with no env", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(getOrApiKey(null)).rejects.toBeInstanceOf(OpenRouterKeyMissing);
  });

  it("falls back to env when provisioning is unconfigured (P0 rollout safety)", async () => {
    // BYOK absent + provisioning helper throws (e.g. OPENROUTER_PROVISIONING_KEY
    // not yet set on this deploy). Resolver must not 500; it falls back to
    // the shared env key so existing users keep working until the env is
    // wired by the orchestrator.
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    vi.mocked(loadUserBucket).mockResolvedValue(null);
    vi.mocked(createUserBucket).mockRejectedValue(
      new Error("OPENROUTER_PROVISIONING_KEY is not set"),
    );
    process.env.OPENROUTER_API_KEY = "rollout-env-fallback";

    const key = await getOrApiKey("user_123");

    expect(key).toBe("rollout-env-fallback");
  });

  it("re-throws non-NO_LLM_KEY BYOK errors instead of silently degrading", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(
      new Error("ECONNREFUSED postgres"),
    );
    process.env.OPENROUTER_API_KEY = "server-env-key";

    await expect(getOrApiKey("user_123")).rejects.toThrow(
      "ECONNREFUSED postgres",
    );
  });
});

describe("OpenRouterTrialExhausted", () => {
  it("exists as a distinct named error class", () => {
    const e = new OpenRouterTrialExhausted();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("OpenRouterTrialExhausted");
  });
});
