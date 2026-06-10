import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { getAuthedUserId } from "@/lib/internal-auth";
import { db } from "@/lib/db";
import { GET } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations`) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/papers/[id]/citations", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper missing", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("403 when paper belongs to other user", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u2" }] }) }),
    } as never);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(403);
  });

  it("returns citations sorted by numeric markerIndex ascending", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    // Ownership check
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u1" }] }) }),
    } as never);
    // Citations query: unsorted rows in; expect orderBy clause to be invoked
    // and the route to return them sorted by markerIndex ascending.
    const unsortedRows = [
      { id: 1, markerIndex: 3, markerText: "[3]", rawText: "C" },
      { id: 2, markerIndex: 1, markerText: "[1]", rawText: "A" },
      { id: 3, markerIndex: 10, markerText: "[10]", rawText: "D" },
      { id: 4, markerIndex: 2, markerText: "[2]", rawText: "B" },
    ];
    // Simulate DB ORDER BY: route delegates sort to DB, mock returns rows in
    // the order the route asked for (numeric ascending by markerIndex).
    const sortedRows = [...unsortedRows].sort((a, b) => a.markerIndex - b.markerIndex);
    const orderByMock = vi.fn().mockResolvedValue(sortedRows);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ orderBy: orderByMock }),
        }),
      }),
    } as never);

    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(200);
    expect(orderByMock).toHaveBeenCalled();
    const body = (await res.json()) as { citations: Array<{ markerIndex: number }> };
    expect(body.citations.map((c) => c.markerIndex)).toEqual([1, 2, 3, 10]);
  });
});
