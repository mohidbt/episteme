// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});

vi.mock("@/lib/folders-server", () => ({
  createFolder: vi.fn(async () => ({ id: "new-folder-uuid", name: "Archive" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 42 }],
        }),
      }),
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

describe("POST /api/folders HMAC dual-auth", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/folders", {
        method: "POST",
        body: JSON.stringify({ libraryId: 42, parentId: null, name: "Archive" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts HMAC-signed request (agent caller)", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/folders", {
        method: "POST",
        body: JSON.stringify({ libraryId: 42, parentId: null, name: "Archive" }),
        headers: {
          "content-type": "application/json",
          "X-Inhale-User-Id": "u1",
          "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
          "X-Inhale-Sig": "deadbeef",
        },
      }),
    );
    // HMAC path must NOT 401 (guest-gate passes through HMAC callers).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
