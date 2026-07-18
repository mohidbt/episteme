import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth";

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
 * Returns the current user id, redirecting to /sign-in if missing.
 *
 * Next.js renders layout and page in parallel, so the layout's session
 * guard doesn't prevent the page from executing server-side. When no
 * session exists this redirects instead of throwing a 500.
 */
export async function getRequiredUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/sign-in");
  return userId;
}
