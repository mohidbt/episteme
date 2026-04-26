import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";
import { jwtVerify } from "jose";
import { auth } from "@episteme/auth";
import { db } from "@episteme/db";
import { notes } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
import { parseNoteDocumentName } from "./document-name.js";

async function resolveUserId(token: string): Promise<string> {
  // JWT bearer path: JWTs always start with base64url-encoded '{"' = "eyJ"
  if (token.startsWith("eyJ") && token.split(".").length === 3) {
    const secret = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET);
    let payload: { userId?: unknown };
    try {
      const result = await jwtVerify(token, secret);
      payload = result.payload as { userId?: unknown };
    } catch {
      throw new Error("unauth: invalid JWT");
    }
    if (typeof payload.userId !== "string") throw new Error("unauth: JWT missing userId");
    return payload.userId;
  }

  // Cookie path: forward token as session cookie
  const headers = new Headers({ cookie: token });
  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error("unauth: invalid session");
  return session.user.id;
}

export function authenticateExt(): Pick<Extension, "onAuthenticate"> {
  return {
    async onAuthenticate({
      token,
      requestHeaders,
      documentName,
    }: onAuthenticatePayload) {
      if (!token) throw new Error("unauth: missing session token");

      // Build request headers for the cookie path — token is the trust anchor,
      // so we strip any cookie from requestHeaders to prevent clobbering.
      const headers = new Headers();
      for (const [k, v] of Object.entries(requestHeaders ?? {})) {
        if (k.toLowerCase() === "cookie") continue;
        const value = Array.isArray(v) ? v.join(", ") : v;
        if (typeof value === "string") headers.set(k, value);
      }

      const userId = await resolveUserId(token);

      const idStr = parseNoteDocumentName(documentName);
      if (!idStr) {
        throw new Error("unauth: malformed documentName — expected 'note:<uuid>'");
      }

      const [row] = await db
        .select({ userId: notes.userId })
        .from(notes)
        .where(eq(notes.id, idStr))
        .limit(1);

      if (!row || row.userId !== userId) {
        throw new Error("unauth: not owner");
      }

      return { user: { id: userId } };
    },
  };
}
