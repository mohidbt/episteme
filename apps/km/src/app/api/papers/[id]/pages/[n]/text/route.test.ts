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
vi.mock("@/lib/ai/pdf-text", () => ({ extractPdfPages: vi.fn() }));

import { db } from "@/lib/db";
import { extractPdfPages } from "@/lib/ai/pdf-text";
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

function mockPaperFound(found: boolean) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () =>
          found ? [{ id: PAPER_ID, userId: "u1", storageUrl: `${PAPER_ID}/source.pdf` }] : [],
      }),
    }),
  } as never);
}

function mockPaperWithoutStorageUrl() {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: PAPER_ID, userId: "u1", storageUrl: null }],
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/papers/[id]/pages/[n]/text", () => {
  it("401 with no auth", async () => {
    const res = await GET(
      new Request(`http://x/api/papers/${PAPER_ID}/pages/1/text`) as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: PAPER_ID, n: "1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("400 on non-numeric page", async () => {
    const path = `/api/papers/${PAPER_ID}/pages/abc/text`;
    const res = await GET(hmacReq(path), {
      params: Promise.resolve({ id: PAPER_ID, n: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when paper not owned", async () => {
    mockPaperFound(false);
    const res = await GET(hmacReq(`/api/papers/${PAPER_ID}/pages/1/text`), {
      params: Promise.resolve({ id: PAPER_ID, n: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 when extractor throws", async () => {
    mockPaperFound(true);
    vi.mocked(extractPdfPages).mockRejectedValue(new Error("boom"));
    const res = await GET(hmacReq(`/api/papers/${PAPER_ID}/pages/1/text`), {
      params: Promise.resolve({ id: PAPER_ID, n: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns page text on valid HMAC + ownership", async () => {
    mockPaperFound(true);
    vi.mocked(extractPdfPages).mockResolvedValue([
      { pageNumber: 1, text: "first" },
      { pageNumber: 2, text: "second" },
    ]);
    const res = await GET(hmacReq(`/api/papers/${PAPER_ID}/pages/2/text`), {
      params: Promise.resolve({ id: PAPER_ID, n: "2" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pageNumber: 2, text: "second" });
  });

  it("falls back to derived source key when storageUrl is missing", async () => {
    mockPaperWithoutStorageUrl();
    vi.mocked(extractPdfPages).mockResolvedValue([{ pageNumber: 1, text: "first" }]);

    const res = await GET(hmacReq(`/api/papers/${PAPER_ID}/pages/1/text`), {
      params: Promise.resolve({ id: PAPER_ID, n: "1" }),
    });

    expect(res.status).toBe(200);
    expect(extractPdfPages).toHaveBeenCalledWith(
      `${PAPER_ID}/source.pdf`,
      expect.any(Object),
    );
  });
});
