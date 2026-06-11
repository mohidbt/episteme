import { describe, it, expect, vi, beforeEach } from "vitest";

const afterCalls: Array<() => Promise<unknown> | unknown> = [];
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (fn: () => Promise<unknown> | unknown) => {
      afterCalls.push(fn);
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
vi.mock("@episteme/auth/byok", () => ({
  getUserS2Key: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/citations/lazy-enrich", () => ({
  enrichRefsForPaperLazily: vi.fn(),
}));

import { getAuthedUserId } from "@/lib/internal-auth";
import { db } from "@/lib/db";
import { enrichRefsForPaperLazily } from "@/lib/citations/lazy-enrich";
import { POST } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations/enrich`, { method: "POST" }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

function mockOwnership(userId: string) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId }] }) }),
  } as never);
}

function mockPendingCount(rows: Array<{ id: number }>) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({ where: async () => rows }),
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  afterCalls.length = 0;
});

describe("POST /api/papers/[id]/citations/enrich", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper missing", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  // GSD-74 round 3: switch POST to fire-and-forget via after() so 76+ refs
  // don't sync-block the function for ~90s of S2 latency + rate-limit retries.
  // Returns the unenriched-count immediately; client polls GET /citations.
  it("returns immediately with current pending count and fires lazy-enrich via after()", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");
    mockPendingCount([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    // lazy-enrich resolves eventually but POST must not await it.
    let lazyDone = false;
    vi.mocked(enrichRefsForPaperLazily).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      lazyDone = true;
      return { enriched: 3, total: 5 };
    });

    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    // POST returned before lazy-enrich completed: after() callback is queued
    // but not yet invoked.
    expect(lazyDone).toBe(false);
    expect(afterCalls).toHaveLength(1);
    expect(enrichRefsForPaperLazily).not.toHaveBeenCalled();
    const body = (await res.json()) as { enriched: number; total: number };
    expect(body.enriched).toBe(0);
    expect(body.total).toBe(5);

    // Drain the queued after() callback to verify it actually runs lazy-enrich.
    await afterCalls[0]();
    expect(lazyDone).toBe(true);
    expect(enrichRefsForPaperLazily).toHaveBeenCalledWith(PAPER_ID, "u1");
  });
});
