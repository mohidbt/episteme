import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { auth } from "@episteme/auth";
import { db } from "@/lib/db";
import { POST } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations/1/save`, { method: "POST" }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID, refId: "1" }) };

beforeEach(() => vi.resetAllMocks());

describe("POST /api/papers/[id]/citations/[refId]/save", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("400 invalid refId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await POST(
      new Request(`http://x/api/papers/${PAPER_ID}/citations/abc/save`, { method: "POST" }) as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: PAPER_ID, refId: "abc" }) },
    );
    expect(res.status).toBe(400);
  });

  it("404 when paper missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });
});
