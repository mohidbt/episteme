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

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET).update(ts + method + path + body).digest("hex");
}

function chain(rows: unknown[]) {
  const c = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValue(c as never);
}

function hmacReq(path: string): NextRequest {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(ts, "GET", path, "");
  return new Request(`http://localhost:3000${path}`, {
    headers: {
      "X-Inhale-User-Id": "user-1",
      "X-Inhale-Ts": ts,
      "X-Inhale-Sig": sig,
    },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/library", () => {
  it("rejects no auth", async () => {
    const res = await GET(new Request("http://localhost/api/library") as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("rejects bad HMAC", async () => {
    const req = new Request("http://localhost/api/library", {
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
      },
    }) as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns refs on valid HMAC", async () => {
    chain([{ id: 1, title: "Paper" }]);
    const res = await GET(hmacReq("/api/library"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1, title: "Paper" }]);
  });

  it("filters by q param", async () => {
    chain([]);
    const res = await GET(hmacReq("/api/library?q=transformer"));
    expect(res.status).toBe(200);
  });
});
