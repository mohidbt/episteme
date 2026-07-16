import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  canonicalInternalAuthPayload,
  INTERNAL_AUTH_SIGNATURE_VERSION,
  verifyInternalAuth,
  MissingInternalSecretError,
} from "./internal-auth";

const SECRET = "test-secret-abc";

function sign(
  ts: string,
  method: string,
  path: string,
  body: string,
  userId = "user-1",
  paperId = "",
  llmKey = "",
  ocrKey = "",
): string {
  return createHmac("sha256", SECRET)
    .update(
      canonicalInternalAuthPayload({
        ts,
        method,
        path,
        body,
        userId,
        paperId,
        llmKey,
        ocrKey,
      }),
    )
    .digest("hex");
}

function authHeaders(
  ts: string,
  sig: string,
  userId = "user-1",
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "X-Inhale-User-Id": userId,
    "X-Inhale-Ts": ts,
    "X-Inhale-Sig": sig,
    "X-Inhale-Sig-Version": INTERNAL_AUTH_SIGNATURE_VERSION,
    ...extra,
  };
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
      headers: authHeaders(ts, sig),
    });
    const result = await verifyInternalAuth(req, "");
    expect(result).toEqual({ ok: true, userId: "user-1" });
  });

  it("returns userId on valid signature (POST with body)", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ title: "x", contentMd: "y" });
    const sig = sign(ts, "POST", "/api/notes", body, "user-2");
    const req = makeRequest({
      method: "POST",
      path: "/api/notes",
      body,
      headers: authHeaders(ts, sig, "user-2", {
        "content-type": "application/json",
      }),
    });
    const result = await verifyInternalAuth(req, body);
    expect(result).toEqual({ ok: true, userId: "user-2" });
  });

  it("rejects bad signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeRequest({
      headers: authHeaders(ts, "deadbeef".repeat(8)),
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
      headers: authHeaders(ts, sig),
    });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric ts", async () => {
    const req = makeRequest({
      headers: authHeaders("notanumber", "x"),
    });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid ts");
  });

  it("rejects future-skew ts (>60s ahead)", async () => {
    const ts = String(Math.floor(Date.now() / 1000) + 120);
    const sig = sign(ts, "GET", "/api/notes/search", "");
    const req = makeRequest({
      headers: authHeaders(ts, sig),
    });
    const result = await verifyInternalAuth(req, "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
  });

  it("throws MissingInternalSecretError when secret unset", async () => {
    delete process.env.INHALE_INTERNAL_SECRET;
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeRequest({
      headers: authHeaders(ts, "deadbeef".repeat(8)),
    });
    await expect(verifyInternalAuth(req, "")).rejects.toBeInstanceOf(
      MissingInternalSecretError,
    );
  });

  // Cross-language golden vector: verifies the JS signer agrees with the
  // Python signer (services/agents/lib/km_http.py) byte-for-byte. The
  // expected hex is computed once in Python:
  //   hmac.new(b"test-secret", canonical_v2_bytes, hashlib.sha256).hexdigest()
  // and hard-coded here. The matching Python test is in
  // services/agents/tests/test_auth.py.
  it("matches Python golden HMAC vector", async () => {
    process.env.INHALE_INTERNAL_SECRET = "test-secret";
    const ts = "1700000000";
    const path = "/api/notes?q=foo";
    const body = '{"title":"hi"}';
    const expected =
      "d18097a1d33e14279d2d7189cbb907125f6b14ea58fc897c767a920966c22efe";
    const computed = createHmac("sha256", "test-secret")
      .update(
        canonicalInternalAuthPayload({
          ts,
          method: "POST",
          path,
          userId: "user-1",
          body,
        }),
      )
      .digest("hex");
    expect(computed).toBe(expected);
    process.env.INHALE_INTERNAL_SECRET = SECRET;
  });

  it("rejects tampering with any signed identity or credential header", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const path = "/api/notes";
    const body = '{"title":"x"}';
    const sig = sign(ts, "POST", path, body, "user-1", "paper-1", "sk-1", "ocr-1");
    const base = authHeaders(ts, sig, "user-1", {
      "X-Inhale-Paper-Id": "paper-1",
      "X-Inhale-LLM-Key": "sk-1",
      "X-Inhale-OCR-Key": "ocr-1",
    });

    for (const [header, value] of [
      ["X-Inhale-User-Id", "user-2"],
      ["X-Inhale-Paper-Id", "paper-2"],
      ["X-Inhale-LLM-Key", "sk-2"],
      ["X-Inhale-OCR-Key", "ocr-2"],
    ] as const) {
      const request = makeRequest({
        method: "POST",
        path,
        body,
        headers: { ...base, [header]: value },
      });
      const result = await verifyInternalAuth(request, body);
      expect(result.ok, header).toBe(false);
    }
  });

  it("fails closed without signature version 2", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(ts, "GET", "/api/notes/search", "");
    const headers = authHeaders(ts, sig);
    delete headers["X-Inhale-Sig-Version"];
    const result = await verifyInternalAuth(makeRequest({ headers }), "");
    expect(result).toEqual({ ok: false, reason: "missing headers" });
  });
});
