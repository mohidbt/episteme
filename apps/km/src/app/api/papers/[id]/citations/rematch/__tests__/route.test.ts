import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/internal-auth")>(
      "@/lib/internal-auth",
    );
  return { ...actual, getAuthedUserId: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("@/lib/citations/auto-link", () => ({
  autoLinkPaperCitations: vi.fn(),
}));

import { getAuthedUserId } from "@/lib/internal-auth";
import { db } from "@/lib/db";
import { autoLinkPaperCitations } from "@/lib/citations/auto-link";
import { POST } from "../route";

const PAPER_ID = "00000000-0000-0000-0000-0000000000aa";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations/rematch`, {
    method: "POST",
  }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

function stubPaperSelect(row: Record<string, unknown> | undefined) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: () => ({ limit: async () => (row ? [row] : []) }),
    }),
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/papers/[id]/citations/rematch", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null as never);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(401);
  });

  it("404 when paper not found", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    stubPaperSelect(undefined);
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(404);
  });

  it("403 when not owned", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    stubPaperSelect({ id: PAPER_ID, userId: "other" });
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(403);
  });

  it("200 + {linked:N} when owned", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false } as never);
    stubPaperSelect({ id: PAPER_ID, userId: "u1" });
    vi.mocked(autoLinkPaperCitations).mockResolvedValue({ linked: 5 });
    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linked).toBe(5);
  });
});
