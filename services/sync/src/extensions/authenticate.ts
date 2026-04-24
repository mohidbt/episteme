import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";
import { auth } from "@episteme/auth";
import { db } from "@episteme/db";
import { notes } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
import { parseNoteDocumentName } from "./document-name.js";

export function authenticateExt(): Pick<Extension, "onAuthenticate"> {
  return {
    async onAuthenticate({
      token,
      requestHeaders,
      documentName,
    }: onAuthenticatePayload) {
      if (!token) throw new Error("unauth: missing session token");

      const headers = new Headers();
      for (const [k, v] of Object.entries(requestHeaders ?? {})) {
        if (k.toLowerCase() === "cookie") continue; // token is the trust anchor, don't let requestHeaders clobber it
        const value = Array.isArray(v) ? v.join(", ") : v;
        if (typeof value === "string") headers.set(k, value);
      }
      headers.set("cookie", token);

      const session = await auth.api.getSession({ headers });
      if (!session?.user) throw new Error("unauth: invalid session");

      const idStr = parseNoteDocumentName(documentName);
      if (!idStr) {
        throw new Error("unauth: malformed documentName — expected 'note:<uuid>'");
      }

      const [row] = await db
        .select({ userId: notes.userId })
        .from(notes)
        .where(eq(notes.id, idStr))
        .limit(1);

      if (!row || row.userId !== session.user.id) {
        throw new Error("unauth: not owner");
      }

      return { user: { id: session.user.id } };
    },
  };
}
