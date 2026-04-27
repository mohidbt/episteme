/**
 * Inbound HMAC verifier for internal service-to-service requests
 * (e.g. from services/agents -> apps/reader).
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
import { auth } from "@episteme/auth/server";

const FRESHNESS_SECONDS = 60;

export type InternalAuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

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
  if (!secret) return { ok: false, reason: "secret not configured" };

  const url = new URL(req.url);
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
 * Returns null on failure. Callers should `return 401` on null.
 *
 * For HMAC requests, pass the already-read raw body string. For session
 * requests, body is unused.
 */
export async function getAuthedUserId(
  req: Request,
  rawBody = "",
): Promise<string | null> {
  if (req.headers.get("x-inhale-sig")) {
    const result = await verifyInternalAuth(req, rawBody);
    return result.ok ? result.userId : null;
  }
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user?.id ?? null;
}
