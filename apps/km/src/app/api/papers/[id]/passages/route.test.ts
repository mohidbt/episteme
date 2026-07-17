import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { internalAuthTestHeaders } from "@/__tests__/internal-auth-headers";

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));

import { db } from "@/lib/db";
import { GET } from "./route";

const SECRET = "test-secret-abc";
const PAPER_ID = "00000000-0000-0000-0000-000000000001";

function hmacReq(path: string) {
  return new Request(`http://localhost:3000${path}`, {
    headers: internalAuthTestHeaders({
      secret: SECRET,
      userId: "u1",
      method: "GET",
      path,
    }),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/papers/[id]/passages", () => {
  it("401 with no auth", async () => {
    const res = await GET(
      new Request(`http://x/api/papers/${PAPER_ID}/passages`) as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: PAPER_ID }) },
    );
    expect(res.status).toBe(401);
  });

  it("404 when paper not owned", async () => {
    vi.mocked(db.select).mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    } as never);
    const res = await GET(hmacReq(`/api/papers/${PAPER_ID}/passages`), {
      params: Promise.resolve({ id: PAPER_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("returns passages for owner", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: async () => [{ id: PAPER_ID, userId: "u1" }] }) }),
      } as never)
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: 1, page: 0, kind: "paragraph", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, payload: { text: "hello world" } },
            ],
          }),
        }),
      } as never);
    const res = await GET(hmacReq(`/api/papers/${PAPER_ID}/passages?q=hello&k=3`), {
      params: Promise.resolve({ id: PAPER_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passages).toHaveLength(1);
  });
});
