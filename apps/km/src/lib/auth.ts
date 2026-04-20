import { auth } from "@episteme/auth";

export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user?.id ?? null;
}
