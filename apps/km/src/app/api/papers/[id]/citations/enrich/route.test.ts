import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => vi.resetAllMocks());

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

  // GSD-74 round 2: align POST to enrichedAt truth-source via lazy-enrich.
  it("delegates to enrichRefsForPaperLazily so total matches UI chip count and enrichedAt is stamped", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    mockOwnership("u1");
    vi.mocked(enrichRefsForPaperLazily).mockResolvedValue({ enriched: 3, total: 5 });

    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enriched: number; total: number };
    expect(body).toEqual({ enriched: 3, total: 5 });
    expect(enrichRefsForPaperLazily).toHaveBeenCalledWith(PAPER_ID, "u1");
  });
});
