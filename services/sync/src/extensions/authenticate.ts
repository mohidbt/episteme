import type { Extension, onAuthenticatePayload } from "@hocuspocus/server";
import { auth } from "@episteme/auth";
import { db } from "@episteme/db";
import { notes } from "@episteme/db/schema";
import { eq } from "drizzle-orm";

// UUID v4 pattern — documentName format: "note:<uuid>"
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authenticateExt(): Pick<Extension, "onAuthenticate"> {
  return {
    async onAuthenticate({
      token,
      requestHeaders,
      documentName,
    }: onAuthenticatePayload) {
      if (!token) throw new Error("unauth: missing session token");

      const headers = new Headers();
      headers.set("cookie", token);
      for (const [k, v] of Object.entries(requestHeaders ?? {})) {
        if (typeof v === "string") headers.set(k, v);
      }

      const session = await auth.api.getSession({ headers });
      if (!session?.user) throw new Error("unauth: invalid session");

      const colonIdx = documentName.indexOf(":");
      if (colonIdx === -1) {
        throw new Error("unauth: malformed documentName — expected 'note:<uuid>'");
      }
      const idStr = documentName.slice(colonIdx + 1);
      if (!UUID_RE.test(idStr)) {
        throw new Error("unauth: malformed documentName — note id must be a UUID");
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
