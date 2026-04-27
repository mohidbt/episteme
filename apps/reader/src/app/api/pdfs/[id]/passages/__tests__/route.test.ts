import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import type { NextRequest } from "next/server";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@episteme/db", () => ({ db: { select: vi.fn() } }));

import { db } from "@episteme/db";
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

let captured = 0;

function mockDocFound(found: boolean) {
  let call = 0;
  vi.mocked(db.select).mockImplementation(() => {
    call++;
    if (call === 1) {
      // Doc ownership lookup: db.select({id}).from(documents).where(...).limit(1)
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(found ? [{ id: 1 }] : []),
      } as never;
    }
    // Segments lookup: db.select({...}).from(segments).where(...).limit(k)
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn((n: number) => {
        captured = n;
        return Promise.resolve([
          { id: 1, page: 1, kind: "section_header", bbox: {}, payload: { text: "hello" } },
        ]);
      }),
    } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = 0;
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/pdfs/[id]/passages", () => {
  it("rejects no auth", async () => {
    const res = await GET(
      new Request("http://localhost/api/pdfs/1/passages") as unknown as NextRequest,
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("rejects bad HMAC", async () => {
    const req = new Request("http://localhost/api/pdfs/1/passages", {
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
      },
    }) as unknown as NextRequest;
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("400 on non-numeric id", async () => {
    const res = await GET(hmacReq("/api/pdfs/abc/passages"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when document not owned", async () => {
    mockDocFound(false);
    const res = await GET(hmacReq("/api/pdfs/1/passages"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns passages with valid HMAC and honors k", async () => {
    mockDocFound(true);
    const res = await GET(hmacReq("/api/pdfs/1/passages?q=hello&k=3"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
    expect(captured).toBe(3);
    const body = await res.json();
    expect(body.passages).toHaveLength(1);
  });
});
