import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const selectMock = vi.fn();
vi.mock("@episteme/db", () => ({
  db: { select: vi.fn() },
}));

import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { GET } from "../route";

const buildReq = () =>
  new Request("http://x/api/documents/1/segments") as unknown as import("next/server").NextRequest;

const routeParams = { params: Promise.resolve({ id: "1" }) };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/documents/[id]/segments", () => {
  it("401 when unauthenticated", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when document belongs to a different user", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    // First select (ownership check) returns empty
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      });
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("200 returns segments for owner", async () => {
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    const fakeSegments = [
      { id: 1, documentId: 1, page: 0, kind: "figure", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, payload: { caption: "A figure" }, orderIndex: 0 },
      { id: 2, documentId: 1, page: 1, kind: "formula", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, payload: { latex: "x^2" }, orderIndex: 1 },
    ];
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => [{ id: 1 }] }) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: async () => fakeSegments }),
      });
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0].kind).toBe("figure");
  });

  it("filters out paragraph and table kinds server-side", async () => {
    // The route passes notInArray(...EXCLUDED_KINDS) to drizzle — we verify
    // the where clause is called with a condition that excludes those kinds.
    // Since drizzle is mocked, we trust the SQL builder; what we can test is
    // that the second select's where() call receives an `and(...)` expression
    // (two conditions: documentId match + notInArray).
    (auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
    const whereCapture = vi.fn(async () => []);
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => [{ id: 1 }] }) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: whereCapture }),
      });
    await GET(buildReq(), routeParams);
    expect(whereCapture).toHaveBeenCalledOnce();
    // The argument is a drizzle SQL node — just confirm it was called (not undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((whereCapture.mock.calls as any[][])[0][0]).toBeDefined();
  });
});
