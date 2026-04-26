import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@episteme/auth";

export interface CurrentSession {
  userId: string;
  isAnonymous: boolean;
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
    };
  },
);

export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
});

/**
 * Returns the current user id, asserting non-null.
 *
 * Pages under `(app)/` rely on the layout to guarantee a session: when no
 * session exists the layout short-circuits to `<AnonAutoSignIn />` and the
 * page never renders. So by the time a page calls this, a user id must
 * exist. If it doesn't, the layout invariant is broken — throw loudly
 * rather than silently mis-rendering.
 */
export async function getRequiredUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error(
      "getRequiredUserId: layout invariant violated — page rendered without session",
    );
  }
  return userId;
}
