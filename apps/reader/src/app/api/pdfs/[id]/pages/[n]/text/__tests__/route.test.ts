import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import type { NextRequest } from "next/server";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@episteme/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/ai/pdf-text", () => ({ extractPdfPages: vi.fn() }));

import { db } from "@episteme/db";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { GET } from "../route";

const SECRET = "test-secret-abc";

function sign(ts: string, m: string, p: string, b: string): string {
  return createHmac("sha256", SECRET).update(ts + m + p + b).digest("hex");
}

function hmacReq(path: string): NextRequest {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(ts, "GET", path, "");
  return new Request(`http://localhost:3000${path}`, {
    headers: {
      "X-Inhale-User-Id": "u1",
      "X-Inhale-Ts": ts,
      "X-Inhale-Sig": sig,
    },
  }) as unknown as NextRequest;
}

function mockDocFound(found: boolean) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(
      found ? [{ id: 1, filePath: "/tmp/x.pdf", userId: "u1" }] : [],
    ),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/pdfs/[id]/pages/[n]/text", () => {
  it("rejects no auth", async () => {
    const res = await GET(
      new Request("http://localhost/api/pdfs/1/pages/1/text") as unknown as NextRequest,
      { params: Promise.resolve({ id: "1", n: "1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("rejects bad HMAC", async () => {
    const req = new Request("http://localhost/api/pdfs/1/pages/1/text", {
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
      },
    }) as unknown as NextRequest;
    const res = await GET(req, { params: Promise.resolve({ id: "1", n: "1" }) });
    expect(res.status).toBe(401);
  });

  it("400 on non-numeric id or page", async () => {
    const res = await GET(hmacReq("/api/pdfs/abc/pages/1/text"), {
      params: Promise.resolve({ id: "abc", n: "1" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when document not owned", async () => {
    mockDocFound(false);
    const res = await GET(hmacReq("/api/pdfs/1/pages/1/text"), {
      params: Promise.resolve({ id: "1", n: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 when extractor throws", async () => {
    mockDocFound(true);
    vi.mocked(extractPdfPages).mockRejectedValue(new Error("missing"));
    const res = await GET(hmacReq("/api/pdfs/1/pages/1/text"), {
      params: Promise.resolve({ id: "1", n: "1" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "page text not extracted" });
  });

  it("404 when page out of range", async () => {
    mockDocFound(true);
    vi.mocked(extractPdfPages).mockResolvedValue([{ pageNumber: 1, text: "hi" }]);
    const res = await GET(hmacReq("/api/pdfs/1/pages/5/text"), {
      params: Promise.resolve({ id: "1", n: "5" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns page text on valid HMAC + ownership", async () => {
    mockDocFound(true);
    vi.mocked(extractPdfPages).mockResolvedValue([
      { pageNumber: 1, text: "first" },
      { pageNumber: 2, text: "second" },
    ]);
    const res = await GET(hmacReq("/api/pdfs/1/pages/2/text"), {
      params: Promise.resolve({ id: "1", n: "2" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pageNumber: 2, text: "second" });
  });
});
