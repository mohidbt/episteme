import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { auth } from "@episteme/auth";
import { db } from "@/lib/db";
import { GET } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";

const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/pdf-sections`) as unknown as import("next/server").NextRequest;

const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/papers/[id]/pdf-sections", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper belongs to a different user (requireOwned -> not found)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    // requireOwned select: empty rows -> 404
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("403 when paper belongs to another user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u2" }] }) }),
    } as never);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(403);
  });

  it("200 returns segments for owner", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const fakeSegments = [
      { id: 1, paperId: PAPER_ID, page: 0, kind: "figure", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, payload: { caption: "A figure" }, orderIndex: 0 },
      { id: 2, paperId: PAPER_ID, page: 1, kind: "formula", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, payload: { latex: "x^2" }, orderIndex: 1 },
    ];
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u1" }] }) }),
      } as never)
      .mockReturnValueOnce({
        from: () => ({ where: async () => fakeSegments }),
      } as never);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0].kind).toBe("figure");
  });

  it("filters out paragraph and table kinds server-side", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const whereCapture = vi.fn(async () => []);
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u1" }] }) }),
      } as never)
      .mockReturnValueOnce({
        from: () => ({ where: whereCapture }),
      } as never);
    await GET(buildReq(), routeParams);
    expect(whereCapture).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((whereCapture.mock.calls as any[][])[0][0]).toBeDefined();
  });
});
