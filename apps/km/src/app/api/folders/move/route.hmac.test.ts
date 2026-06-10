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
  moveFolder: vi.fn(async () => undefined),
}));

import { getAuthedUserId } from "@/lib/internal-auth";

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/folders/move HMAC dual-auth", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/folders/move", {
        method: "POST",
        body: JSON.stringify({
          folderId: "00000000-0000-0000-0000-000000000001",
          targetParentId: null,
        }),
        headers: { "content-type": "application/json" },
      }),
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
      new Request("http://localhost/api/folders/move", {
        method: "POST",
        body: JSON.stringify({
          folderId: "00000000-0000-0000-0000-000000000001",
          targetParentId: null,
        }),
        headers: {
          "content-type": "application/json",
          "X-Inhale-User-Id": "u1",
          "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
          "X-Inhale-Sig": "deadbeef",
        },
      }),
    );
    expect(res.status).not.toBe(401);
  });
});
