// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openrouter-key", () => ({
  getOrApiKey: vi.fn(),
}));

import { getOrApiKey } from "../openrouter-key";
import { withOrKeyRetry, OrKeyTransientError } from "../or-key-retry";

beforeEach(() => {
  vi.mocked(getOrApiKey).mockReset();
});

describe("withOrKeyRetry (GSD-140)", () => {
  it("returns attempt result on first success (resolves key once)", async () => {
    vi.mocked(getOrApiKey).mockResolvedValue("key-A");
    const attempt = vi.fn().mockResolvedValue("ok");

    const result = await withOrKeyRetry("user_1", attempt);

    expect(result).toBe("ok");
    expect(getOrApiKey).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith("key-A");
  });

  it("retries exactly once on a transient 401/402: re-resolves + retries", async () => {
    vi.mocked(getOrApiKey)
      .mockResolvedValueOnce("stale-key")
      .mockResolvedValueOnce("fresh-key");
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new OrKeyTransientError(401))
      .mockResolvedValueOnce("ok-second");

    const result = await withOrKeyRetry("user_1", attempt);

    expect(result).toBe("ok-second");
    expect(getOrApiKey).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenNthCalledWith(1, "stale-key");
    expect(attempt).toHaveBeenNthCalledWith(2, "fresh-key");
  });

  it("gives up after one retry (no infinite loop)", async () => {
    vi.mocked(getOrApiKey).mockResolvedValue("k");
    const attempt = vi
      .fn()
      .mockRejectedValue(new OrKeyTransientError(402));

    await expect(withOrKeyRetry("user_1", attempt)).rejects.toBeInstanceOf(
      OrKeyTransientError,
    );
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(getOrApiKey).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on non-transient errors", async () => {
    vi.mocked(getOrApiKey).mockResolvedValue("k");
    const attempt = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withOrKeyRetry("user_1", attempt)).rejects.toThrow("boom");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(getOrApiKey).toHaveBeenCalledTimes(1);
  });
});
