/**
 * HMAC-auth path tests for /api/notes/search. The sibling route.test.ts
 * covers cookie-auth via real Postgres. These tests mock `db.select` to focus
 * on the HMAC verifier + k-honoring behavior added in Phase 1.3b.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

import { db } from "@/lib/db";
import { GET } from "./route";

const SECRET = "test-secret-abc";

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET).update(ts + method + path + body).digest("hex");
}

function chain(rows: unknown[]) {
  let captured = 0;
  const c = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn((n: number) => {
      captured = n;
      return Promise.resolve(rows);
    }),
    _capturedLimit: () => captured,
  };
  vi.mocked(db.select).mockReturnValue(c as never);
  return c;
}

function hmacReq(path: string): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(ts, "GET", path, "");
  return new Request(`http://localhost:3001${path}`, {
    headers: {
      "X-Inhale-User-Id": "user-1",
      "X-Inhale-Ts": ts,
      "X-Inhale-Sig": sig,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("GET /api/notes/search [HMAC]", () => {
  it("rejects bad HMAC (401)", async () => {
    const req = new Request("http://localhost:3001/api/notes/search?q=x", {
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": String(Math.floor(Date.now() / 1000)),
        "X-Inhale-Sig": "bad".repeat(20),
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns results with valid HMAC", async () => {
    chain([{ id: "n1", title: "hello", slug: "hello" }]);
    const res = await GET(hmacReq("/api/notes/search?q=hello"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ id: "n1", title: "hello", slug: "hello" }]);
  });

  it("honors k param (capped at 50, default 10)", async () => {
    const c1 = chain([]);
    await GET(hmacReq("/api/notes/search?q=a&k=25"));
    expect(c1._capturedLimit()).toBe(25);

    const c2 = chain([]);
    await GET(hmacReq("/api/notes/search?q=a&k=999"));
    expect(c2._capturedLimit()).toBe(50);

    const c3 = chain([]);
    await GET(hmacReq("/api/notes/search?q=a"));
    expect(c3._capturedLimit()).toBe(10);
  });
});
