import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paperCitations, papers, references_ } from "@episteme/db/schema";

// O2: manual paper attach + disconnect on /r/[id]. Restores the UX deleted in
// b8b7556 (over-eager H-batch cleanup).
//
// Manual attach is the user explicitly identifying a library reference with a
// library paper, overriding (or supplementing) DOI/title-derived identity.
// We store the override in two places:
//   1. references_.paperId — the legacy direct pointer (also used by
//      getReferencesForPaper). Acts as the authoritative override consulted
//      by findIdentityPaperForReference.
//   2. paper_citations with citer_kind='reference', citer_id=refId (UUID),
//      cited_kind='paper', cited_id=paperId, match_method='manual'. This
//      keeps manual edges semantically distinct from bibliography-citation
//      edges (which are docRef-int-keyed under the Symmetry contract,
//      Task #57).
//
// Disconnect undoes BOTH the row override and the manual edge. Bibliography
// edges (citer_id = String(document_references.id)) are untouched.

export type ManualAttachResult =
  | { ok: true; paperId: string }
  | { ok: false; reason: "paper_not_found" | "paper_not_owned" | "reference_not_owned" };

export async function attachReferenceToPaper(
  refId: string,
  userId: string,
  paperId: string,
): Promise<ManualAttachResult> {
  const refRows = await db
    .select({ id: references_.id, userId: references_.userId })
    .from(references_)
    .where(eq(references_.id, refId))
    .limit(1);
  const ref = refRows[0];
  if (!ref) return { ok: false, reason: "reference_not_owned" };
  if (ref.userId !== userId) return { ok: false, reason: "reference_not_owned" };

  const paperRows = await db
    .select({ id: papers.id, userId: papers.userId })
    .from(papers)
    .where(eq(papers.id, paperId))
    .limit(1);
  const paper = paperRows[0];
  if (!paper) return { ok: false, reason: "paper_not_found" };
  if (paper.userId !== userId) return { ok: false, reason: "paper_not_owned" };

  await db.update(references_).set({ paperId }).where(eq(references_.id, refId));

  await db
    .insert(paperCitations)
    .values({
      citerKind: "reference" as const,
      citerId: refId,
      citedKind: "paper" as const,
      citedId: paperId,
      sourceMarkerIdx: null,
      matchMethod: "manual" as const,
    })
    .onConflictDoNothing();

  return { ok: true, paperId };
}

export async function detachReferenceFromPaper(
  refId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "reference_not_owned" }> {
  const refRows = await db
    .select({ id: references_.id, userId: references_.userId, paperId: references_.paperId })
    .from(references_)
    .where(eq(references_.id, refId))
    .limit(1);
  const ref = refRows[0];
  if (!ref) return { ok: false, reason: "reference_not_owned" };
  if (ref.userId !== userId) return { ok: false, reason: "reference_not_owned" };

  // Clear the override pointer first.
  await db.update(references_).set({ paperId: null }).where(eq(references_.id, refId));

  // Drop manual edges keyed on this reference UUID. Bibliography edges
  // (citer_id = String(document_references.id) — integers cast to text) are
  // left alone since their citer_id never equals refId.
  await db
    .delete(paperCitations)
    .where(
      and(
        eq(paperCitations.citerKind, "reference"),
        eq(paperCitations.citerId, refId),
        eq(paperCitations.citedKind, "paper"),
        eq(paperCitations.matchMethod, "manual"),
      ),
    );

  return { ok: true };
}
