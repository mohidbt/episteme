import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import type { NextRequest } from "next/server";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@episteme/db", () => ({ db: { select: vi.fn(), insert: vi.fn() } }));

import { db } from "@episteme/db";
import { POST } from "../route";

const SECRET = "test-secret-abc";

function sign(ts: string, m: string, p: string, b: string): string {
  return createHmac("sha256", SECRET).update(ts + m + p + b).digest("hex");
}

function hmacReq(path: string, bodyObj: object): NextRequest {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(bodyObj);
  const sig = sign(ts, "POST", path, body);
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    body,
    headers: {
      "X-Inhale-User-Id": "u1",
      "X-Inhale-Ts": ts,
      "X-Inhale-Sig": sig,
      "content-type": "application/json",
    },
  }) as unknown as NextRequest;
}

function mockDocFound(found: boolean) {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(found ? [{ id: 1 }] : []),
  } as never);
  vi.mocked(db.insert).mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 99, pageNumber: 2 }]),
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

describe("POST /api/pdfs/[id]/highlights", () => {
  it("rejects no auth", async () => {
    const req = new Request("http://localhost/api/pdfs/1/highlights", {
      method: "POST",
      body: JSON.stringify({ page: 1, range: "0-10" }),
    }) as unknown as NextRequest;
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects bad HMAC", async () => {
    const req = new Request("http://localhost/api/pdfs/1/highlights", {
      method: "POST",
      body: JSON.stringify({ page: 1, range: "0-10" }),
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
      },
    }) as unknown as NextRequest;
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("400 on non-numeric id", async () => {
    const res = await POST(hmacReq("/api/pdfs/abc/highlights", { page: 1, range: "0-10" }), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("422 on invalid range", async () => {
    const res = await POST(hmacReq("/api/pdfs/1/highlights", { page: 1, range: "weird" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(422);
  });

  it("422 on missing page", async () => {
    const res = await POST(hmacReq("/api/pdfs/1/highlights", { range: "0-10" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(422);
  });

  it("404 when document not owned", async () => {
    mockDocFound(false);
    const res = await POST(hmacReq("/api/pdfs/1/highlights", { page: 1, range: "0-10" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(404);
  });

  it("creates highlight on valid HMAC + body", async () => {
    mockDocFound(true);
    const res = await POST(
      hmacReq("/api/pdfs/1/highlights", { page: 2, range: "0-50", note: "k" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.highlight.id).toBe(99);
  });
});
