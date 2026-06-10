import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { papers, documentReferences, keptCitations } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; refId: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function POST(request: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  const { id: paperId, refId } = await params;
  const documentReferenceId = parseInt(refId, 10);
  if (isNaN(documentReferenceId)) return jsonError(400, "invalid ref id");

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const [ref] = await db
      .select({ id: documentReferences.id })
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.id, documentReferenceId),
          eq(documentReferences.paperId, paperId),
        ),
      )
      .limit(1);

    if (!ref) return jsonError(404, "citation not found");

    // Race-free idempotent insert: ON CONFLICT DO NOTHING returns the new
    // row, or no rows if it already existed. On conflict we re-fetch.
    const [inserted] = await db
      .insert(keptCitations)
      .values({
        userId,
        documentReferenceId,
        libraryReferenceId: null,
      })
      .onConflictDoNothing()
      .returning({ id: keptCitations.id });

    if (inserted) {
      return NextResponse.json({ keptId: inserted.id, alreadyKept: false });
    }

    const [existing] = await db
      .select({ id: keptCitations.id })
      .from(keptCitations)
      .where(
        and(
          eq(keptCitations.userId, userId),
          eq(keptCitations.documentReferenceId, documentReferenceId),
        ),
      )
      .limit(1);

    return NextResponse.json({ keptId: existing.id, alreadyKept: true });
  } catch (err) {
    console.error("[citations/keep] failed for paper", paperId, "ref", documentReferenceId, err);
    return jsonError(500, "internal server error");
  }
}
