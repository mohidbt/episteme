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
  new Request(`http://x/api/papers/${PAPER_ID}/citations/markers`) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/papers/[id]/citations/markers", () => {
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
});
