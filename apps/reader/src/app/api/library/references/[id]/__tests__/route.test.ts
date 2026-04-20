import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth and db before importing route
vi.mock("@episteme/auth/server", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock("@episteme/db", () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
  },
}));

import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { DELETE } from "../route";

const mockGetSession = vi.mocked(auth.api.getSession);

function mockSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValue(chain as never);
}

function mockDeleteChain() {
  const chain = {
    where: vi.fn().mockResolvedValue([]),
  };
  vi.mocked(db.delete).mockReturnValue(chain as never);
}

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/library/references/${id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/library/references/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(makeRequest("1"), { params: Promise.resolve({ id: "1" }) });

    expect(res.status).toBe(401);
  });

  it("returns 404 when row does not exist", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockSelectChain([]); // no rows found

    const res = await DELETE(makeRequest("99"), { params: Promise.resolve({ id: "99" }) });

    expect(res.status).toBe(404);
  });

  it("returns 404 when row belongs to another user (ownership leak prevention)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } } as never);
    // Row exists but owned by a different user
    mockSelectChain([{ id: 42, userId: "user-other" }]);

    const res = await DELETE(makeRequest("42"), { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(404);
  });

  it("deletes the row and returns 204 on success", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockSelectChain([{ id: 7, userId: "user-1" }]);
    mockDeleteChain();

    const res = await DELETE(makeRequest("7"), { params: Promise.resolve({ id: "7" }) });

    expect(res.status).toBe(204);
    expect(vi.mocked(db.delete)).toHaveBeenCalledOnce();
  });

  it("returns 400 for a non-numeric id", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await DELETE(makeRequest("abc"), { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(400);
  });
});
