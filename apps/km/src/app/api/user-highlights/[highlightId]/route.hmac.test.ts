// @vitest-environment node
// HMAC dual-auth migration: PATCH and DELETE on user-highlights/[id].
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1, userId: "u1", comment: "x", note: null }]) }) }),
    }),
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
    }),
  },
}));

import { getAuthedUserId } from "@/lib/internal-auth";

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ctx = { params: Promise.resolve({ highlightId: "1" }) };

describe("PATCH /api/user-highlights/[id] HMAC", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/user-highlights/1", {
        method: "PATCH",
        body: JSON.stringify({ comment: "hi" }),
        headers: { "content-type": "application/json" },
      }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-authenticated request", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/user-highlights/1", {
        method: "PATCH",
        body: JSON.stringify({ comment: "hi" }),
        headers: {
          "content-type": "application/json",
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

describe("DELETE /api/user-highlights/[id] HMAC", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/user-highlights/1", {
        method: "DELETE",
      }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-authenticated request", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/user-highlights/1", {
        method: "DELETE",
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
