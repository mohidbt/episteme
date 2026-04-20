import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
const updateMock = vi.fn();
vi.mock("@episteme/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateMock })) })),
  },
}));

import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { PATCH } from "../route";

const buildReq = (body: unknown) =>
  new Request("http://x/api/documents/1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;

beforeEach(() => vi.resetAllMocks());

describe("PATCH /api/documents/[id]", () => {
  it("401 when unauthenticated", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await PATCH(buildReq({ title: "x" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("400 when title empty / whitespace", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    const res = await PATCH(buildReq({ title: "   " }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("400 when title >255 chars", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    const res = await PATCH(
      buildReq({ title: "a".repeat(256) }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("404 when doc not owned", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });
    const res = await PATCH(buildReq({ title: "ok" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });

  it("200 + trims title on success", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ id: 1, userId: "u1" }] }) }),
    });
    updateMock.mockResolvedValue(undefined);
    const res = await PATCH(
      buildReq({ title: "  New Title  " }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.title).toBe("New Title");
    expect(updateMock).toHaveBeenCalledOnce();
  });
});
