import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@episteme/auth";

export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
});
