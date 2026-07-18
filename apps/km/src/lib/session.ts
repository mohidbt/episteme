import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { shouldBlockForEmailVerification } from "./email-verify-gate";

export interface CurrentSession {
  userId: string;
  isAnonymous: boolean;
  /**
   * better-auth core `User.emailVerified` (mirrors the `email_verified`
   * column). Anonymous users are created unverified; the hard-block gate
   * (GSD-142) exempts them via `isAnonymous`, so this stays informational
   * for them. The anon-plugin user object may omit this field at runtime,
   * hence the `Boolean(...)` coercion below (undefined -> false).
   */
  emailVerified: boolean;
}

export const getCurrentSession = cache(
  async (): Promise<CurrentSession | null> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return null;
    return {
      userId: session.user.id,
      isAnonymous: Boolean(
        (session.user as { isAnonymous?: boolean }).isAnonymous,
      ),
      emailVerified: Boolean(
        (session.user as { emailVerified?: boolean }).emailVerified,
      ),
    };
  },
);

export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
});

/**
 * GSD-142: reads the session and enforces the email-verification gate.
 *
 * Redirects to /sign-in when there is no session, and to /verify-email when
 * an unverified real (non-anonymous) user is present — otherwise returns the
 * session. This is the defense-in-depth choke point for `(app)` server pages:
 * because Next.js renders the layout and its sibling pages in parallel, the
 * layout's `redirect()` does NOT stop a page's data fetches from running. Any
 * data-fetching `(app)` page MUST call this (or `getRequiredUserId`, which
 * composes it) as its FIRST await, so the redirect throws before a protected
 * query executes. Anonymous/guest sessions are exempt (anon->signup funnel).
 *
 * The layout guard is retained as a backstop — it still short-circuits HTML
 * delivery — but this helper is what actually gates the parallel page render.
 */
export async function requireVerifiedSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  if (shouldBlockForEmailVerification(session)) redirect("/verify-email");
  return session;
}

/**
 * Returns the current user id, redirecting to /sign-in if missing and to
 * /verify-email for an unverified real user (GSD-142). Anonymous users are
 * never gated. See {@link requireVerifiedSession} for the parallel-render
 * rationale.
 */
export async function getRequiredUserId(): Promise<string> {
  const session = await requireVerifiedSession();
  return session.userId;
}
