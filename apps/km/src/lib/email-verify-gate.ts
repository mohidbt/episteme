import type { CurrentSession } from "./session";

/**
 * GSD-142: mandatory email verification (hard-block), anon-exempt.
 *
 * Returns true when the app should redirect this session to /verify-email.
 * Blocks ONLY a real (non-anonymous) user whose email is not yet verified.
 * Anonymous/guest sessions are always exempt — they have no real email and
 * can never verify; gating them would break the anon->signup funnel. A missing
 * session is not this gate's concern (handled by the layout's anon bootstrap).
 */
export function shouldBlockForEmailVerification(
  session: CurrentSession | null,
): boolean {
  if (!session) return false;
  if (session.isAnonymous) return false;
  return session.emailVerified !== true;
}
