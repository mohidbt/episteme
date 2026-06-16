import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    // Invoke after() callbacks synchronously so we can assert on their
    // effects within the same tick as the GET response.
    after: (cb: () => Promise<void> | void) => {
      void Promise.resolve().then(() => cb());
    },
  };
});

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
vi.mock("@/lib/citations/enrich-refs", () => ({
  enrichRefsWithPaperMatchAndEdges: vi.fn(async (refs: unknown[]) =>
    (refs as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      matchedPaperId: null,
      citedInCount: 0,
      citingCount: 0,
    })),
  ),
}));
vi.mock("@/lib/citations/lazy-enrich", () => ({
  enrichRefsForPaperLazily: vi.fn().mockResolvedValue({ enriched: 0, total: 0 }),
}));

import { getAuthedUserId } from "@/lib/internal-auth";
import { db } from "@/lib/db";
import { enrichRefsForPaperLazily } from "@/lib/citations/lazy-enrich";
import { GET } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations`) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

function mockOwnership(userId: string) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId }] }) }),
  } as never);
}

function mockCitationsRows(rows: Array<Record<string, unknown>>) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      leftJoin: () => ({
        where: () => ({ orderBy: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
  } as never);
}

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
    mockOwnership("u1");
    const unsortedRows = [
      { id: 1, markerIndex: 3, markerText: "[3]", rawText: "C", enrichedAt: new Date(), doi: null },
      { id: 2, markerIndex: 1, markerText: "[1]", rawText: "A", enrichedAt: new Date(), doi: null },
      { id: 3, markerIndex: 10, markerText: "[10]", rawText: "D", enrichedAt: new Date(), doi: null },
      { id: 4, markerIndex: 2, markerText: "[2]", rawText: "B", enrichedAt: new Date(), doi: null },
    ];
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

  // GSD-125 — GET is read-only. Enrichment moved to manual POST /citations/enrich.
  // Auto `after()` enrichment was removed because S2 rate-limit churn on every
  // panel open was wasteful; users now trigger it explicitly.

  it("does NOT trigger enrichment even when refs have enrichedAt=null + doi", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");
    const rows = [
      { id: 1, markerIndex: 1, markerText: "[1]", doi: "10.1/abc", enrichedAt: null, title: null },
      { id: 2, markerIndex: 2, markerText: "[2]", doi: "10.2/def", enrichedAt: null, title: null },
    ];
    mockCitationsRows(rows);

    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citations: Array<{ enrichedAt: string | null }> };
    expect(body.citations).toHaveLength(2);
    expect(body.citations[0].enrichedAt).toBeNull();

    // Flush any pending microtasks; lazy-enrich must NOT have been invoked.
    await new Promise((r) => setTimeout(r, 0));
    expect(enrichRefsForPaperLazily).not.toHaveBeenCalled();
  });

  it("does NOT trigger enrichment when every ref already has enrichedAt set", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");
    const now = new Date();
    const rows = [
      { id: 1, markerIndex: 1, markerText: "[1]", doi: "10.1/abc", enrichedAt: now, title: "T1" },
      { id: 2, markerIndex: 2, markerText: "[2]", doi: "10.2/def", enrichedAt: now, title: "T2" },
    ];
    mockCitationsRows(rows);

    await GET(buildReq(), routeParams);
    await new Promise((r) => setTimeout(r, 0));
    expect(enrichRefsForPaperLazily).not.toHaveBeenCalled();
  });
});
