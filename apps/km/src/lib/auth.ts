import { auth } from "@episteme/auth";

export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user?.id ?? null;
}

export async function getSessionInfo(
  req: Request,
): Promise<{ userId: string; isAnonymous: boolean } | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    isAnonymous: Boolean((session.user as { isAnonymous?: boolean }).isAnonymous),
  };
}
