// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const ORIGINAL_KEY = process.env.OPENROUTER_PROVISIONING_KEY;

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.OPENROUTER_PROVISIONING_KEY = "prov-test-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_PROVISIONING_KEY;
  else process.env.OPENROUTER_PROVISIONING_KEY = ORIGINAL_KEY;
});

describe("openrouter-provisioning", () => {
  describe("createUserBucket", () => {
    it("POSTs /api/v1/keys with name + $5 cap and returns { key, hash }", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ key: "sk-or-runtime", data: { hash: "h_abc" } }),
          { status: 200 },
        ),
      );
      const { createUserBucket } = await import("../openrouter-provisioning");

      const result = await createUserBucket("user_123");

      expect(result).toEqual({ key: "sk-or-runtime", hash: "h_abc" });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://openrouter.ai/api/v1/keys");
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer prov-test-key",
        "Content-Type": "application/json",
      });
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({
        name: "episteme-user_123",
        label: "trial",
        limit: 5,
        limit_reset: null,
        include_byok_in_limit: false,
      });
    });

    it("throws when OPENROUTER_PROVISIONING_KEY is missing", async () => {
      delete process.env.OPENROUTER_PROVISIONING_KEY;
      const { createUserBucket } = await import("../openrouter-provisioning");
      await expect(createUserBucket("user_x")).rejects.toThrow(
        /OPENROUTER_PROVISIONING_KEY/,
      );
    });

    it("throws on non-OK OR response", async () => {
      fetchMock.mockResolvedValue(
        new Response("internal err", { status: 500 }),
      );
      const { createUserBucket } = await import("../openrouter-provisioning");
      await expect(createUserBucket("user_x")).rejects.toThrow();
    });
  });

  describe("getUserBucketUsage", () => {
    it("GETs /api/v1/keys/{hash} and parses usage + limit", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ data: { usage: 1.23, limit: 5 } }),
          { status: 200 },
        ),
      );
      const { getUserBucketUsage } = await import("../openrouter-provisioning");

      const result = await getUserBucketUsage("h_abc");

      expect(result).toEqual({ usageUsd: 1.23, limitUsd: 5 });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://openrouter.ai/api/v1/keys/h_abc");
      expect((init as RequestInit).method ?? "GET").toBe("GET");
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer prov-test-key",
      });
    });

    it("supports flat OR response shape (no `data` wrapper)", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ usage: 2.5, limit: 5 }), { status: 200 }),
      );
      const { getUserBucketUsage } = await import("../openrouter-provisioning");
      const result = await getUserBucketUsage("h_abc");
      expect(result).toEqual({ usageUsd: 2.5, limitUsd: 5 });
    });

    it("throws on non-OK", async () => {
      fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
      const { getUserBucketUsage } = await import("../openrouter-provisioning");
      await expect(getUserBucketUsage("h_nope")).rejects.toThrow();
    });
  });

  describe("patchUserBucket", () => {
    it("sends PATCH to /api/v1/keys/{hash} with the provided fields", async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
      const { patchUserBucket } = await import("../openrouter-provisioning");

      await patchUserBucket("h_abc", { limit: 10, limit_reset: "weekly" });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://openrouter.ai/api/v1/keys/h_abc");
      expect((init as RequestInit).method).toBe("PATCH");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({ limit: 10, limit_reset: "weekly" });
    });

    it("throws on non-OK", async () => {
      fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
      const { patchUserBucket } = await import("../openrouter-provisioning");
      await expect(patchUserBucket("h_abc", { limit: 1 })).rejects.toThrow();
    });
  });
});
