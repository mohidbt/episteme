// @vitest-environment node
// GSD-101 — HMAC dual-auth for GET /api/notes/:id/revisions/:rev.
// The agent's `diff_revision` tool calls this endpoint over HMAC; without
// dual-auth, every call 401s because the route was previously cookie-only.
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
        where: () =>
          Promise.resolve([{ id: "note-1", contentMd: "snapshot content" }]),
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

const ctx = {
  params: Promise.resolve({ id: "note-1", rev: "rev-1" }),
};

describe("GET /api/notes/:id/revisions/:rev HMAC", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/notes/note-1/revisions/rev-1", {
        method: "GET",
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
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/notes/note-1/revisions/rev-1", {
        method: "GET",
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
