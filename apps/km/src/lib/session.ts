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
