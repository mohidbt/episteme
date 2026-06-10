import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_, noteLinks, papers } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { requireNonGuestAuthed } from "@/lib/auth/require-non-guest";
import { referenceUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { getTrashFolderId, moveItemToFolder } from "@/lib/folders-server";
import { isUniqueViolation, suggestNextCitationKey } from "@/lib/references";
import { autoConnectReference, extractRefSignals } from "@/lib/citations/match-ref-to-papers";
import { mergeRefCslIntoPaper } from "@/lib/citations/merge-ref-csl-into-paper";

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return misconfiguredResponse(); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;
  const res = await requireOwned<any>(references_, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  // K9: anonymous guests cannot edit references. HMAC callers pass through.
  const gate = await requireNonGuestAuthed(req, rawBody);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const { id } = await params;
  const body = JSON.parse(rawBody);
  const parsed = referenceUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<any>(references_, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const { folderId, ...rest } = parsed.data;
  if (folderId !== undefined) {
    if (rest.folderPath !== undefined) {
      console.warn("references PATCH: folderPath ignored when folderId is present");
    }
    try {
      await moveItemToFolder({ kind: "reference", itemId: id, userId, targetFolderId: folderId });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (status === 404) return jsonError(404, "folder_not_found");
      throw err;
    }
  }
  const hasOtherUpdates = Object.keys(rest).length > 0;
  try {
    if (hasOtherUpdates) {
      const prevCsl = res.row.cslJson;
      const [row] = await db.update(references_).set(rest).where(eq(references_.id, id)).returning();
      if ("cslJson" in rest) {
        await autoConnectReference(id, userId, extractRefSignals(rest.cslJson));
        // GSD-72: when the ref is bound to a paper, propagate any CSL field
        // that maps to a paper column (title/authors/year/doi/abstract/venue)
        // onto the paper row. Best-effort: must not fail the ref PATCH.
        if (row?.paperId) {
          try {
            const patch = mergeRefCslIntoPaper(prevCsl as never, row.cslJson as never);
            if (Object.keys(patch).length > 0) {
              await db.update(papers).set(patch).where(eq(papers.id, row.paperId));
            }
          } catch (err) {
            console.warn(`refs PATCH: paper merge failed for ref ${id}`, err);
          }
        }
      }
      return Response.json(row);
    }
    const [row] = await db.select().from(references_).where(eq(references_.id, id));
    return Response.json(row);
  } catch (err) {
    if (isUniqueViolation(err) && typeof rest.citationKey === "string") {
      return Response.json(
        { error: "citation_key_conflict", suggestion: suggestNextCitationKey(rest.citationKey) },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return misconfiguredResponse(); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;
  const res = await requireOwned<any>(references_, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  const trashId = await getTrashFolderId(res.row.libraryId, userId);
  if (res.row.folderId !== trashId) {
    return jsonError(400, "items must be in trash before permanent delete");
  }

  // Cascade: note_links has no FK on targetId (polymorphic). Manually wipe references before the row.
  await db.transaction(async (tx) => {
    await tx.delete(noteLinks).where(and(eq(noteLinks.targetKind, "reference"), eq(noteLinks.targetId, id)));
    await tx.delete(references_).where(eq(references_.id, id));
  });
  return new Response(null, { status: 204 });
}
