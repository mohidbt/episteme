import { NextRequest, NextResponse } from "next/server";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { db } from "@/lib/db";
import { papers, documentReferences, documentReferenceMarkers } from "@episteme/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { extractCitations } from "@/lib/citations/parser";
import { extractAnnotationMarkers } from "@/lib/citations/annotation-extractor";
import { authorStringToJson } from "@/lib/citations/author-utils";
import { paperSourceKey } from "@/lib/storage";
import { extractDoiFromFirstPage } from "@/lib/papers/extract-doi-from-first-page";
import { fetchPaperReferences, type S2Reference } from "@/lib/semantic-scholar";

function authorsArrayToJson(
  authors: { name: string }[] | null | undefined,
): { name: string }[] | null {
  if (!authors || authors.length === 0) return null;
  return authors.map((a) => ({ name: a.name }));
}

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

function isUpstreamDependencyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("AGENTS_URL missing") ||
    err.message.includes("INHALE_INTERNAL_SECRET missing") ||
    err.message.includes("[pdf-text] agents request failed") ||
    err.message.includes("[annotation-extractor] agents request failed") ||
    err.message.includes("fetch failed")
  );
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  const paper = owned.row;
  const sourceLocator = paper.storageUrl ?? paperSourceKey(paperId);
  let llmKey = "";
  try {
    llmKey = await getDecryptedApiKey(userId);
  } catch {
    llmKey = "";
  }

  try {
    let annRefs: Awaited<ReturnType<typeof extractAnnotationMarkers>>["references"] = [];
    let annMarkers: Awaited<ReturnType<typeof extractAnnotationMarkers>>["markers"] = [];
    let usedAnnotations = false;

    try {
      const annResult = await extractAnnotationMarkers(sourceLocator, {
        userId,
        paperId,
        llmKey,
      });
      annRefs = annResult.references;
      annMarkers = annResult.markers;
      // Require at least 3 resolved references to trust annotation extraction.
      // A single spurious internal link on a bracket-style PDF must not suppress
      // the text-regex fallback that would have found all [n] references.
      usedAnnotations = annRefs.length >= 3;
    } catch (annErr) {
      console.warn(
        "[citations/extract] annotation extraction failed, falling back to text-regex",
        annErr,
      );
    }

    let inserted: typeof documentReferences.$inferSelect[] = [];
    let markersInserted = 0;
    let extractionMethodOverride: string | null = null;

    if (usedAnnotations) {
      await db
        .delete(documentReferences)
        .where(eq(documentReferences.paperId, paperId));

      inserted = await db
        .insert(documentReferences)
        .values(
          annRefs.map((ref) => ({
            paperId,
            markerText: `[${ref.markerIndex}]`,
            markerIndex: ref.markerIndex,
            rawText: ref.rawText ?? null,
            title: ref.title ?? null,
            authors: authorStringToJson(ref.authors),
            year: ref.year ?? null,
            doi: ref.doi ?? null,
            url: ref.url ?? null,
            semanticScholarId: null,
            abstract: null,
            venue: null,
            citationCount: null,
            pageNumber: null,
          })),
        )
        .returning();

      const refIdByMarkerIndex = new Map<number, number>(
        inserted.map((r) => [r.markerIndex, r.id]),
      );

      const markerRows = annMarkers
        .map((m) => {
          const referenceId = refIdByMarkerIndex.get(m.markerIndex);
          if (referenceId == null) return null;
          return {
            referenceId,
            pageNumber: m.pageNumber,
            x0: m.x0,
            y0: m.y0,
            x1: m.x1,
            y1: m.y1,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (markerRows.length > 0) {
        await db.insert(documentReferenceMarkers).values(markerRows);
        markersInserted = markerRows.length;
      }
    } else {
      const pages = await extractPdfPages(sourceLocator, {
        userId,
        paperId,
        llmKey,
      });
      const { markers, references } = extractCitations(pages);

      const markerPageMap = new Map<number, number>(
        markers.map((m) => [m.markerIndex, m.pageNumber]),
      );

      // ── Source-DOI extract + S2 references enrichment ──────────────────
      // If we don't yet know the source paper's DOI, try a tiny LLM extract
      // from the first page; once known, fetch S2 references and use them
      // as the metadata source-of-truth (positions stay from text-parse).
      let sourceDoi = paper.doi ?? null;
      if (!sourceDoi && pages.length > 0 && llmKey) {
        const guess = await extractDoiFromFirstPage(pages[0]?.text ?? "", {
          openrouterKey: llmKey,
          userId,
        });
        if (guess) {
          sourceDoi = guess;
          try {
            await db
              .update(papers)
              .set({ doi: guess })
              .where(and(eq(papers.id, paperId), isNull(papers.doi)));
          } catch (err) {
            console.warn("[citations/extract] persist papers.doi failed", err);
          }
        }
      }

      let s2Refs: S2Reference[] | null = null;
      if (sourceDoi) {
        s2Refs = await fetchPaperReferences(sourceDoi);
      }
      const s2Enriched = s2Refs !== null;

      if (references.length > 0) {
        await db
          .delete(documentReferences)
          .where(eq(documentReferences.paperId, paperId));

        inserted = await db
          .insert(documentReferences)
          .values(
            references.map((ref) => {
              // Pair S2 ref to text-parse marker by index (1-indexed markers
              // ↔ 0-indexed S2 array, in citation order).
              const s2 = s2Enriched ? s2Refs![ref.markerIndex - 1] ?? null : null;
              return {
                paperId,
                markerText: `[${ref.markerIndex}]`,
                markerIndex: ref.markerIndex,
                rawText: ref.rawText ?? null,
                title: s2?.title ?? ref.title ?? null,
                authors: s2
                  ? authorsArrayToJson(s2.authors)
                  : authorStringToJson(ref.authors),
                year: s2?.year != null ? String(s2.year) : ref.year ?? null,
                doi: s2?.doi ?? ref.doi ?? null,
                url: ref.url ?? null,
                semanticScholarId: s2?.paperId ?? null,
                abstract: s2?.abstract ?? null,
                venue: s2?.venue ?? null,
                citationCount: s2?.citationCount ?? null,
                pageNumber: markerPageMap.get(ref.markerIndex) ?? null,
              };
            }),
          )
          .returning();
      }

      if (s2Enriched) {
        extractionMethodOverride = "text-regex+s2";
      }
    }

    return NextResponse.json(
      {
        references: inserted,
        stats: {
          markersFound: usedAnnotations ? annMarkers.length : 0,
          referencesExtracted: inserted.length,
          referencesInserted: inserted.length,
          markersInserted,
          extractionMethod:
            extractionMethodOverride ?? (usedAnnotations ? "annotations" : "text-regex"),
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[citations/extract] failed for paper", paperId, err);
    if (isUpstreamDependencyError(err)) {
      return NextResponse.json(
        {
          references: [],
          stats: {
            markersFound: 0,
            referencesExtracted: 0,
            referencesInserted: 0,
            markersInserted: 0,
            extractionMethod: "unavailable",
          },
          unavailable: true,
        },
        { status: 200 },
      );
    }
    return jsonError(500, "internal server error");
  }
}
