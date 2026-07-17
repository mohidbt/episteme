import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";
import { jwtVerify } from "jose";
import { auth } from "@episteme/auth";
import { db } from "@episteme/db";
import { notes } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
import { parseNoteDocumentName } from "./document-name.js";

const COLLAB_JWT_ISSUER = "episteme-km";
const COLLAB_JWT_AUDIENCE = "episteme-sync";
const MIN_SECRET_BYTES = 32;

function jwtSecret(): Uint8Array {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || new TextEncoder().encode(value).byteLength < MIN_SECRET_BYTES) {
    throw new Error("unauth: collab JWT verifier is not configured");
  }
  return new TextEncoder().encode(value);
}

async function resolveUserId(token: string): Promise<string> {
  // JWT bearer path: JWTs always start with base64url-encoded '{"' = "eyJ"
  if (token.startsWith("eyJ") && token.split(".").length === 3) {
    let payload: { userId?: unknown };
    try {
      const result = await jwtVerify(token, jwtSecret(), {
        algorithms: ["HS256"],
        issuer: COLLAB_JWT_ISSUER,
        audience: COLLAB_JWT_AUDIENCE,
      });
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
