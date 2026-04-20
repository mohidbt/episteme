import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documents, documentReferences, keptCitations } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; refId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, refId } = await params;
  const documentId = parseInt(id, 10);
  const documentReferenceId = parseInt(refId, 10);
  if (isNaN(documentId) || isNaN(documentReferenceId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  try {
    // Verify document ownership
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Verify document_reference belongs to this document
    const [ref] = await db
      .select({ id: documentReferences.id })
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.id, documentReferenceId),
          eq(documentReferences.documentId, documentId)
        )
      )
      .limit(1);

    if (!ref) {
      return NextResponse.json({ error: "Citation not found" }, { status: 404 });
    }

    // Race-free idempotent insert: ON CONFLICT DO NOTHING returns the new
    // row, or no rows if it already existed. On conflict we re-fetch.
    const [inserted] = await db
      .insert(keptCitations)
      .values({
        userId: session.user.id,
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
          eq(keptCitations.userId, session.user.id),
          eq(keptCitations.documentReferenceId, documentReferenceId)
        )
      )
      .limit(1);

    return NextResponse.json({ keptId: existing.id, alreadyKept: true });
  } catch (err) {
    console.error("[citations/keep] failed for document", documentId, "ref", documentReferenceId, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
