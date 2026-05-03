import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({ headers: { "X-Inhale-Sig": "stub" }, ts: "0" })),
}));

import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { GET } from "./route";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/outline`) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

beforeEach(() => vi.resetAllMocks());

describe("GET /api/papers/[id]/outline", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await GET(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });
});
