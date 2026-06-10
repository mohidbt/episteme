// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});

vi.mock("@/lib/db", () => {
  const refRow = { id: 1 };
  const keptRow = { id: 99 };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "p1", userId: "u1" }, refRow][0] ? [{ id: "p1", userId: "u1" }] : []),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([keptRow]),
          }),
        }),
      }),
    },
  };
});

import { getAuthedUserId } from "@/lib/internal-auth";

const ctx = { params: Promise.resolve({ id: "p1", refId: "1" }) };

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/citations/[refId]/keep HMAC dual-auth", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/papers/p1/citations/1/keep", {
        method: "POST",
      }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-signed request", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/papers/p1/citations/1/keep", {
        method: "POST",
        headers: {
          "X-Inhale-User-Id": "u1",
          "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
          "X-Inhale-Sig": "deadbeef",
        },
      }),
      ctx,
    );
    expect(res.status).not.toBe(401);
  });
});
