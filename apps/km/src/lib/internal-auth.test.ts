import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { verifyInternalAuth } from "./internal-auth";

const SECRET = "test-secret-abc";

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET)
    .update(ts + method + path + body)
    .digest("hex");
}

function makeRequest(opts: {
  method?: string;
  path?: string;
  body?: string;
  headers?: Record<string, string>;
}): Request {
  const method = opts.method ?? "GET";
  const path = opts.path ?? "/api/notes/search";
  const url = `http://localhost:3001${path}`;
  return new Request(url, {
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

describe("verifyInternalAuth", () => {
  it("returns userId on valid signature (GET, empty body)", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const path = "/api/notes/search?q=foo";
    const sig = sign(ts, "GET", path, "");
    const req = makeRequest({
      path,
      headers: {
        "X-Inhale-User-Id": "user-1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
      },
    });
    const result = await verifyInternalAuth(req, "");
    expect(result).toEqual({ ok: true, userId: "user-1" });
  });

  it("returns userId on valid signature (POST with body)", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ title: "x", contentMd: "y" });
    const sig = sign(ts, "POST", "/api/notes", body);
    const req = makeRequest({
      method: "POST",
      path: "/api/notes",
      body,
      headers: {
        "X-Inhale-User-Id": "user-2",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "content-type": "application/json",
      },
    });
    const result = await verifyInternalAuth(req, body);
    expect(result).toEqual({ ok: true, userId: "user-2" });
  });

  it("rejects bad signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeRequest({
      headers: {
        "X-Inhale-User-Id": "user-1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": "deadbeef".repeat(8),
      },
    });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
  });

  it("rejects missing headers", async () => {
    const req = makeRequest({ headers: {} });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
  });

  it("rejects stale timestamp (>60s)", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 120);
    const sig = sign(ts, "GET", "/api/notes/search", "");
    const req = makeRequest({
      headers: {
        "X-Inhale-User-Id": "user-1",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
      },
    });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric ts", async () => {
    const req = makeRequest({
      headers: {
        "X-Inhale-User-Id": "user-1",
        "X-Inhale-Ts": "notanumber",
        "X-Inhale-Sig": "x",
      },
    });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
  });
});
