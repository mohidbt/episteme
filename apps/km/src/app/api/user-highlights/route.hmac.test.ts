// @vitest-environment node
// HMAC dual-auth migration: GET and DELETE accept HMAC-signed agent requests.
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
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve([]), limit: () => Promise.resolve([]) }),
        limit: () => Promise.resolve([]),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  },
}));

vi.mock("@/lib/crud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crud")>("@/lib/crud");
  return {
    ...actual,
    requireOwned: vi.fn(async () => ({
      ok: true,
      row: { id: "p1", userId: "u1", libraryId: 1 },
    })),
  };
});

import { getAuthedUserId } from "@/lib/internal-auth";

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/user-highlights HMAC dual-auth", () => {
  it("401 when getAuthedUserId returns null", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/user-highlights?paperId=p1"),
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-authenticated request (not 401)", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://localhost/api/user-highlights?paperId=00000000-0000-0000-0000-000000000001",
        {
          headers: {
            "X-Inhale-User-Id": "u1",
            "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
            "X-Inhale-Sig": "deadbeef",
          },
        },
      ),
    );
    expect(res.status).not.toBe(401);
  });
});

describe("DELETE /api/user-highlights HMAC dual-auth", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/user-highlights?paperId=p1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-authenticated request (not 401)", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(
        "http://localhost/api/user-highlights?paperId=00000000-0000-0000-0000-000000000001",
        {
          method: "DELETE",
          headers: {
            "X-Inhale-User-Id": "u1",
            "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
            "X-Inhale-Sig": "deadbeef",
          },
        },
      ),
    );
    expect(res.status).not.toBe(401);
  });
});
