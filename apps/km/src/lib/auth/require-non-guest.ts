/**
 * Guest-gate for write routes that incur cost (uploads, OR spend).
 *
 * The guest demo seeds a populated library so anonymous users can explore
 * without uploading anything. Upload-init endpoints (papers/assets POST,
 * library import) hand out presigned PUTs that lead to downstream OR spend
 * (PDF parsing, embeddings, etc.); a guest with a cookie can therefore
 * bypass the OR-spend cap by smuggling in arbitrary content unless the
 * server-side route refuses anonymous sessions.
 *
 * Two flavours, matching the two auth shapes used in /api/*:
 *
 *   - `requireNonGuestSession(req)` — for routes that only accept the
 *     Better Auth cookie (single-auth). Returns the userId or a 401/403
 *     `NextResponse`-compatible `Response`.
 *
 *   - `requireNonGuestAuthed(req, rawBody?)` — for dual-auth routes that
 *     accept either the cookie OR an internal HMAC. HMAC callers are
 *     server-to-server (agents) and have no notion of "guest", so they
 *     are passed through. Cookie callers go through the same anonymous
 *     check as the single-auth helper.
 *
 * Both helpers return discriminated unions so the caller can `if (!ok)
 * return r.response;` and TypeScript narrows `r.userId` for the success path.
 */
import { jsonError } from "@/lib/crud";
import { getSessionInfo } from "@/lib/auth";
import {
  getAuthedUserId,
  MissingInternalSecretError,
  type AuthedUser,
} from "@/lib/internal-auth";

export type RequireNonGuestResult =
  | { ok: true; userId: string; viaHmac: boolean }
  | { ok: false; response: Response };

export async function requireNonGuestSession(
  req: Request,
): Promise<RequireNonGuestResult> {
  const session = await getSessionInfo(req);
  if (!session) return { ok: false, response: jsonError(401, "unauthorized") };
  if (session.isAnonymous) {
    return { ok: false, response: jsonError(403, "guest_forbidden") };
  }
  return { ok: true, userId: session.userId, viaHmac: false };
}

export async function requireNonGuestAuthed(
  req: Request,
  rawBody = "",
): Promise<RequireNonGuestResult> {
  let authed: AuthedUser | null;
  try {
    authed = await getAuthedUserId(req, rawBody);
  } catch (e) {
    if (e instanceof MissingInternalSecretError) {
      return {
        ok: false,
        response: jsonError(500, "internal auth misconfigured"),
      };
    }
    throw e;
  }
  if (!authed) return { ok: false, response: jsonError(401, "unauthorized") };
  // HMAC = server-to-server (agents). No guest concept; pass through.
  if (authed.viaHmac) {
    return { ok: true, userId: authed.userId, viaHmac: true };
  }
  // Cookie session — check anonymous flag.
  const session = await getSessionInfo(req);
  if (session?.isAnonymous) {
    return { ok: false, response: jsonError(403, "guest_forbidden") };
  }
  return { ok: true, userId: authed.userId, viaHmac: false };
}
