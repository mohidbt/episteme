/**
 * Inbound HMAC verifier for internal service-to-service requests
 * (e.g. from services/agents -> apps/km or apps/reader).
 *
 * Mirrors `services/agents/deps/auth.py::require_internal`. Signature scheme:
 *   sig = HMAC-SHA256(INHALE_INTERNAL_SECRET, ts + method + path + body)
 * Headers: X-Inhale-User-Id, X-Inhale-Ts, X-Inhale-Sig.
 *
 * Routes use this in a dual-auth pattern: accept either a Better Auth session
 * cookie OR a valid HMAC. See `getAuthedUserId` below.
 *
 * Note: outbound signer (services/agents/lib/km_http.py) signs path INCLUDING
 * query string, so this verifier signs `pathname + search` to match.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { auth } from "./server";

const FRESHNESS_SECONDS = 60;

export class MissingInternalSecretError extends Error {
  constructor() {
    super("INHALE_INTERNAL_SECRET is not configured");
    this.name = "MissingInternalSecretError";
  }
}

export type InternalAuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

export type AuthedUser = { userId: string; viaHmac: boolean };

/**
 * Verify an HMAC-signed internal request.
 * Throws `MissingInternalSecretError` if the server is misconfigured (no secret).
 * Returns ok=false for any other auth failure (bad sig, stale, missing headers).
 */
export async function verifyInternalAuth(
  req: Request,
  rawBody: string,
): Promise<InternalAuthResult> {
  const userId = req.headers.get("x-inhale-user-id");
  const ts = req.headers.get("x-inhale-ts");
  const sig = req.headers.get("x-inhale-sig");
  if (!userId || !ts || !sig) {
    return { ok: false, reason: "missing headers" };
  }
  const tsInt = Number(ts);
  if (!Number.isFinite(tsInt)) return { ok: false, reason: "invalid ts" };
  if (Math.abs(Math.floor(Date.now() / 1000) - tsInt) > FRESHNESS_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const secret = process.env.INHALE_INTERNAL_SECRET;
  if (!secret) {
    // Misconfiguration — caller should surface this as 500, not 401.
    console.error("[internal-auth] INHALE_INTERNAL_SECRET is not set");
    throw new MissingInternalSecretError();
  }

  const url = new URL(req.url);
  // Outbound `km_http.py` signs the path INCLUDING query string, so we match
  // by signing `pathname + search`. The Python inbound verifier does the same.
  const signedPath = url.pathname + url.search;

  const expected = createHmac("sha256", secret)
    .update(ts + req.method + signedPath + rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "sig mismatch" };
  }
  return { ok: true, userId };
}

/**
 * Resolve the authed user via either Better Auth session OR a valid HMAC.
 * Returns null on auth failure. Callers should `if (!authed) return jsonError(401)`.
 *
 * Throws `MissingInternalSecretError` if INHALE_INTERNAL_SECRET is unset on an
 * HMAC-headered request — the route handler should map that to a 500 response
 * (not a misleading 401), since the server itself is misconfigured.
 *
 * For HMAC requests, pass the already-read raw body string. For session
 * requests, body is unused.
 */
export async function getAuthedUserId(
  req: Request,
  rawBody = "",
): Promise<AuthedUser | null> {
  // Fast path: HMAC headers present -> verify HMAC only.
  if (req.headers.get("x-inhale-sig")) {
    const result = await verifyInternalAuth(req, rawBody);
    return result.ok ? { userId: result.userId, viaHmac: true } : null;
  }
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user?.id
    ? { userId: session.user.id, viaHmac: false }
    : null;
}
