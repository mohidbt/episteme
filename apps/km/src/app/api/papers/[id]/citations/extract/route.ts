import { NextRequest, NextResponse, after } from "next/server";
import { getOrApiKey, OpenRouterKeyMissing } from "@/lib/openrouter-key";
import { db } from "@/lib/db";
import { papers, documentReferences, documentReferenceMarkers } from "@episteme/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { extractCitations } from "@/lib/citations/parser";
import { autoLinkPaperCitations } from "@/lib/citations/auto-link";
import { extractAnnotationMarkers } from "@/lib/citations/annotation-extractor";
import { authorStringToJson } from "@/lib/citations/author-utils";
import { paperSourceKey } from "@/lib/storage";
import { extractDoiFromFirstPage } from "@/lib/papers/extract-doi-from-first-page";
import { enrichPaperReferencesInDb } from "@/lib/citations/enrich-paper";

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
  // URL parse (not nextUrl) — tests pass a plain `Request` without nextUrl.
  const force = new URL(request.url).searchParams.get("force") === "1";

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");
  const paper = owned.row;

  // Idempotency gate: when citations already exist for this paper, return
  // them as-is unless ?force=1 is passed. Prevents accidental re-extract
  // (and duplicate LLM/S2 spend) from the /p/[id] Find citations button.
  if (!force) {
    const existing = await db
      .select()
      .from(documentReferences)
      .where(eq(documentReferences.paperId, paperId));
    if (existing.length > 0) {
      // Cached-extract re-enrichment: when any cached row is missing S2
      // metadata (semanticScholarId IS NULL), re-fire enrichment in the
      // background. Without this, papers extracted before the enrichment
      // pipeline existed — or whose first enrichment run was killed by the
      // serverless deadline — keep returning blank citation cards forever.
      if (existing.some((r) => r.semanticScholarId == null)) {
        after(async () => {
          try {
            await enrichPaperReferencesInDb(paperId, userId);
          } catch (err) {
            console.warn("[citations/extract] cached re-enrich failed", err);
          }
        });
      }
      return NextResponse.json(
        {
          references: existing,
          stats: {
            markersFound: 0,
            referencesExtracted: existing.length,
            referencesInserted: existing.length,
            markersInserted: 0,
            extractionMethod: "cached",
          },
          alreadyExtracted: true,
        },
        { status: 200 },
      );
    }
  }
  const sourceLocator = paper.storageUrl ?? paperSourceKey(paperId);
  // BYOK first, then server-side OPENROUTER_API_KEY fallback. Guests
  // without BYOK still get DOI extract via the server key (~$0.001/paper).
  let llmKey = "";
  try {
    llmKey = await getOrApiKey(userId);
  } catch (err) {
    // OpenRouterKeyMissing → no LLM available; downstream DOI extract is
    // gated on truthy llmKey, so empty string is the safe no-op.
    if (!(err instanceof OpenRouterKeyMissing)) throw err;
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

      // Source-paper DOI discovery: persist for future enrich/auto-link.
      // S2 enrichment of REFS happens post-insert per-row (see autoEnrich
      // below) — NOT via source-paper /references ordinal merge. Codex
      // task-mpbm0thh-3f0tz8 flagged ordinal merge as unsafe: null-filtered
      // S2 list compresses, indices shift, wrong metadata maps onto real
      // citation rects.
      if (!paper.doi && pages.length > 0 && llmKey) {
        const guess = await extractDoiFromFirstPage(pages[0]?.text ?? "", {
          openrouterKey: llmKey,
          userId,
        });
        if (guess) {
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

      if (references.length > 0) {
        await db
          .delete(documentReferences)
          .where(eq(documentReferences.paperId, paperId));

        inserted = await db
          .insert(documentReferences)
          .values(
            references.map((ref) => ({
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
              pageNumber: markerPageMap.get(ref.markerIndex) ?? null,
            })),
          )
          .returning();
      }
    }

    // Post-response background work via Next 16 `after()` — survives the
    // response on Vercel (plain `void promise` gets killed at handler exit
    // on serverless). Both jobs are best-effort; errors logged only.
    //
    // - auto-link paper_citations edges (D2).
    // - per-row S2 enrichment: fills title/authors/year/doi/abstract/venue/
    //   citationCount on every ref via DOI-then-title lookup. Pure per-row
    //   resolution, no ordinal assumption — see plan pivot 2026-05-18
    //   (Codex task-mpbm0thh-3f0tz8 risk #1).
    if (inserted.length > 0) {
      after(async () => {
        try {
          await autoLinkPaperCitations(paperId);
        } catch (err) {
          console.warn("[citations/extract] auto-link failed", err);
        }
        try {
          await enrichPaperReferencesInDb(paperId, userId);
        } catch (err) {
          console.warn("[citations/extract] enrich failed", err);
        }
      });
    }

    return NextResponse.json(
      {
        references: inserted,
        stats: {
          markersFound: usedAnnotations ? annMarkers.length : 0,
          referencesExtracted: inserted.length,
          referencesInserted: inserted.length,
          markersInserted,
          extractionMethod: usedAnnotations ? "annotations" : "text-regex",
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
