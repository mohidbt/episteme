import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { papers, documentReferences, libraryReferences, keptCitations, references_, libraries, folders } from "@episteme/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { buildLibraryReference } from "@/lib/citations/library-sync";
import { deriveCitationKey, type CslItem } from "@/lib/csl";
import { insertReferenceWithSuffixBump } from "@/lib/references";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; refId: string }> };
type PaperRow = typeof papers.$inferSelect;

function refToCsl(ref: typeof documentReferences.$inferSelect): CslItem {
  const issuedYear = ref.year ? Number.parseInt(ref.year, 10) : NaN;
  return {
    id: `docref-${ref.id}`,
    type: "article-journal",
    title: ref.title ?? ref.rawText ?? ref.markerText,
    author: (ref.authors ?? []).map((a) => ({ literal: a.name })),
    issued: Number.isFinite(issuedYear) ? { "date-parts": [[issuedYear]] } : undefined,
    DOI: ref.doi ?? undefined,
    URL: ref.url ?? undefined,
    "container-title": ref.venue ?? undefined,
    abstract: ref.abstract ?? undefined,
  };
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId, refId } = await params;
  const documentReferenceId = parseInt(refId, 10);
  if (isNaN(documentReferenceId)) return jsonError(400, "invalid ref id");

  // Optional folderId in body — places the new library_reference into a folder.
  let folderId: string | null = null;
  try {
    const text = await request.text();
    if (text) {
      const parsed = JSON.parse(text) as { folderId?: string | null };
      if (typeof parsed.folderId === "string" && parsed.folderId.length > 0) {
        folderId = parsed.folderId;
      }
    }
  } catch {
    // empty body or bad JSON → folder stays null
  }

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const paper = owned.row;
    const [ref] = await db
      .select()
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.id, documentReferenceId),
          eq(documentReferences.paperId, paperId),
        ),
      )
      .limit(1);

    if (!ref) return jsonError(404, "citation not found");

    let folderPath = "";
    if (folderId) {
      const [folder] = await db
        .select({ id: folders.id, path: folders.path })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
        .limit(1);
      if (!folder) return jsonError(400, "invalid_folder");
      folderPath = folder.path;
    }

    const libraryId = paper.libraryId ?? (
      await db
        .select({ id: libraries.id })
        .from(libraries)
        .where(eq(libraries.userId, userId))
        .limit(1)
    )[0]?.id;
    if (!libraryId) return jsonError(400, "no_library");

    // Find or create library_reference.
    // With a DOI we can use ON CONFLICT against the partial unique index
    // (userId, doi) WHERE doi IS NOT NULL — race-free under concurrent saves.
    // Without a DOI we insert a new row (dedup isn't meaningful without a DOI).
    let libraryReferenceId: number;
    const payload = { ...buildLibraryReference(userId, ref), folderId };

    if (ref.doi) {
      const [row] = await db
        .insert(libraryReferences)
        .values(payload)
        .onConflictDoUpdate({
          target: [libraryReferences.userId, libraryReferences.doi],
          targetWhere: sql`${libraryReferences.doi} IS NOT NULL`,
          set: {
            title: payload.title,
            authors: payload.authors,
            year: payload.year,
            url: payload.url,
            semanticScholarId: payload.semanticScholarId,
            abstract: payload.abstract,
            venue: payload.venue,
            citationCount: payload.citationCount,
            folderId: payload.folderId,
          },
        })
        .returning({ id: libraryReferences.id });
      libraryReferenceId = row.id;
    } else {
      const [row] = await db
        .insert(libraryReferences)
        .values(payload)
        .returning({ id: libraryReferences.id });
      libraryReferenceId = row.id;
    }

    // Also persist into canonical `references` table so the /references library
    // view immediately reflects "Save to Library" actions from the reader.
    const csl = refToCsl(ref);
    const citationKey = deriveCitationKey(csl);
    await insertReferenceWithSuffixBump({
      libraryId,
      userId,
      folderId,
      folderPath,
      citationKey,
      cslJson: csl,
      paperId,
    });

    const [kept] = await db
      .insert(keptCitations)
      .values({
        userId,
        documentReferenceId,
        libraryReferenceId,
      })
      .onConflictDoUpdate({
        target: [keptCitations.userId, keptCitations.documentReferenceId],
        set: { libraryReferenceId },
      })
      .returning({ id: keptCitations.id });

    return NextResponse.json({ libraryReferenceId, keptId: kept.id });
  } catch (err) {
    console.error("[citations/save] failed for paper", paperId, "ref", documentReferenceId, err);
    return jsonError(500, "internal server error");
  }
}
