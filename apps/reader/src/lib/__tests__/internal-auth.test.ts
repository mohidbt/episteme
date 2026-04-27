import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";

vi.mock("@episteme/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import {
  verifyInternalAuth,
  getAuthedUserId,
  MissingInternalSecretError,
} from "../internal-auth";

const SECRET = "test-secret-abc";

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET).update(ts + method + path + body).digest("hex");
}

function makeReq(opts: {
  method?: string;
  path?: string;
  body?: string;
  headers?: Record<string, string>;
}): Request {
  const method = opts.method ?? "GET";
  const path = opts.path ?? "/api/library";
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: opts.headers,
    body: method === "GET" ? undefined : opts.body,
  });
}

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.INHALE_INTERNAL_SECRET;
});

describe("verifyInternalAuth (reader)", () => {
  it("accepts valid GET with query", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const path = "/api/library?q=foo";
    const sig = sign(ts, "GET", path, "");
    const req = makeReq({
      path,
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
      },
    });
    const res = await verifyInternalAuth(req, "");
    expect(res).toEqual({ ok: true, userId: "u1" });
  });

  it("rejects bad sig", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeReq({
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": "bad".repeat(20),
      },
    });
    const res = await verifyInternalAuth(req, "");
    expect(res.ok).toBe(false);
  });

  it("rejects missing headers", async () => {
    const res = await verifyInternalAuth(makeReq({ headers: {} }), "");
    expect(res.ok).toBe(false);
  });

  it("rejects future-skew (ts > now + 60s)", async () => {
    const ts = String(Math.floor(Date.now() / 1000) + 120);
    const sig = sign(ts, "GET", "/api/library", "");
    const req = makeReq({
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
      },
    });
    const res = await verifyInternalAuth(req, "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("stale");
  });

  it("throws MissingInternalSecretError when unset", async () => {
    delete process.env.INHALE_INTERNAL_SECRET;
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeReq({
      headers: {
        "X-Inhale-User-Id": "u",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": "x".repeat(64),
      },
    });
    await expect(verifyInternalAuth(req, "")).rejects.toBeInstanceOf(
      MissingInternalSecretError,
    );
  });

  // Cross-language golden vector. See apps/km/src/lib/internal-auth.test.ts
  // and services/agents/tests/test_auth.py for the matching assertions.
  it("matches Python golden HMAC vector", async () => {
    const ts = "1700000000";
    const path = "/api/notes?q=foo";
    const body = '{"title":"hi"}';
    const expected =
      "b79393e07c11da2acad023e6bb8884a499303486bbcc5889884a41a44427e6a8";
    const computed = createHmac("sha256", "test-secret")
      .update(ts + "POST" + path + body)
      .digest("hex");
    expect(computed).toBe(expected);
  });

  it("rejects stale", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 120);
    const sig = sign(ts, "GET", "/api/library", "");
    const req = makeReq({
      headers: {
        "X-Inhale-User-Id": "u1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
      },
    });
    expect((await verifyInternalAuth(req, "")).ok).toBe(false);
  });
});

describe("getAuthedUserId", () => {
  it("returns null on no auth", async () => {
    const id = await getAuthedUserId(makeReq({ headers: {} }));
    expect(id).toBeNull();
  });

  it("returns userId + viaHmac=true on valid HMAC", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(ts, "GET", "/api/library", "");
    const req = makeReq({
      headers: {
        "X-Inhale-User-Id": "u-hmac",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
      },
    });
    expect(await getAuthedUserId(req, "")).toEqual({
      userId: "u-hmac",
      viaHmac: true,
    });
  });
});
