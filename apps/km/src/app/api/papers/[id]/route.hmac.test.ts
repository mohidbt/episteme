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
  const whereChain = {
    limit: () => Promise.resolve([{ id: "trash-1" }]),
    then: (resolve: (v: unknown) => unknown) =>
      resolve([{ id: "p1", userId: "u1", folderId: "trash-1", libraryId: 1 }]),
  };
  return {
    db: {
      select: () => ({ from: () => ({ where: () => whereChain }) }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "p1" }]) }) }),
      }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    },
  };
});

vi.mock("@/lib/storage", () => ({
  storage: { deleteObject: vi.fn(async () => undefined) },
  paperSourceKey: (id: string) => `source/${id}`,
  paperCoverKey: (id: string) => `cover/${id}`,
}));

vi.mock("@/lib/papers/get-paper-with-merged-ref", () => ({
  getPaperWithMergedRef: vi.fn(async () => ({ id: "p1", userId: "u1" })),
}));

vi.mock("@/lib/crud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crud")>("@/lib/crud");
  return {
    ...actual,
    requireOwned: vi.fn(async () => ({
      ok: true,
      row: { id: "p1", userId: "u1", folderId: null, libraryId: 1 },
    })),
  };
});

import { getAuthedUserId } from "@/lib/internal-auth";

const ctx = { params: Promise.resolve({ id: "p1" }) };

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("papers/[id] HMAC dual-auth", () => {
  it("GET 401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/papers/p1"), ctx);
    expect(res.status).toBe(401);
  });

  it("GET accepts HMAC", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/papers/p1", {
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

  it("PATCH 401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/papers/p1", {
        method: "PATCH",
        body: JSON.stringify({ title: "T" }),
        headers: { "content-type": "application/json" },
      }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("PATCH accepts HMAC", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/papers/p1", {
        method: "PATCH",
        body: JSON.stringify({ title: "T" }),
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

  it("DELETE 401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/papers/p1", { method: "DELETE" }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("DELETE accepts HMAC", async () => {
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig"))
        return { userId: "u1", viaHmac: true };
      return null;
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/papers/p1", {
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
