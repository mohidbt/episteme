import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  papers,
  paperCitations,
} from "@episteme/db/schema";

// D2: auto-link paper_citations rows from document_references after extract.
//
// For each documentReferences row tied to `paperId`:
//   1. If ref.doi → exact match against papers.doi; on hit → edge to that
//      paper with match_method='doi'.
//   2. Else if ref.title → fuzzy match against papers.title (normalized
//      substring containment); on hit → match_method='title-fuzzy'.
//   3. Otherwise edge to the reference itself (cited_kind='reference').
//
// Idempotent via the (citer_kind,citer_id,cited_kind,cited_id) UNIQUE index
// + ON CONFLICT DO NOTHING. Insert errors mentioning the table not existing
// degrade to {linked:0} so the caller doesn't fail when migration lags
// behind code deploy.

export interface AutoLinkResult {
  linked: number;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingRelationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("paper_citations") &&
    (msg.includes("does not exist") || msg.includes("relation"))
  );
}

export async function autoLinkPaperCitations(
  paperId: string,
): Promise<AutoLinkResult> {
  const refs = await db
    .select({
      id: documentReferences.id,
      paperId: documentReferences.paperId,
      doi: documentReferences.doi,
      title: documentReferences.title,
      markerIndex: documentReferences.markerIndex,
    })
    .from(documentReferences)
    .where(eq(documentReferences.paperId, paperId));

  let linked = 0;

  for (const ref of refs) {
    let citedKind: "paper" | "reference" = "reference";
    let citedId: string = String(ref.id);
    let matchMethod: "doi" | "title-fuzzy" | "manual" = "manual";

    if (ref.doi) {
      const hits = (await db
        .select({ id: papers.id })
        .from(papers)
        .where(eq(papers.doi, ref.doi))
        .limit(1)) as Array<{ id: string }>;
      if (hits.length > 0) {
        citedKind = "paper";
        citedId = hits[0].id;
        matchMethod = "doi";
      } else {
        citedKind = "reference";
        citedId = String(ref.id);
        matchMethod = "manual"; // unresolved — placeholder method
      }
    } else if (ref.title) {
      // Fuzzy: scan recent papers, pick first with normalized substring overlap
      // ≥ 80% of the shorter normalized title. Skip too-short normalized titles
      // (≤ 15 chars) to avoid false matches on generic stubs like "AI" or
      // "Deep Learning".
      const norm = normalizeTitle(ref.title);
      // Skip fuzzy match for too-short normalized titles to avoid false
      // matches on generic stubs like "AI" or "Deep Learning"; fall through
      // to "reference" fallback so the edge still gets recorded.
      const FUZZY_CAP = 500;
      const hit =
        norm.length <= 15
          ? undefined
          : await (async () => {
              const candidates = (await db
                .select({ id: papers.id, title: papers.title })
                .from(papers)
                .limit(FUZZY_CAP)) as Array<{ id: string; title: string | null }>;
              if (candidates.length === FUZZY_CAP) {
                console.warn(
                  "[auto-link] fuzzy candidate cap hit",
                  FUZZY_CAP,
                  "— some matches may be missed for paper",
                  paperId,
                );
              }
              return candidates.find((c) => {
                if (!c.title) return false;
                const cn = normalizeTitle(c.title);
                if (cn.length === 0 || norm.length === 0) return false;
                const shorter = cn.length < norm.length ? cn : norm;
                const longer = cn.length < norm.length ? norm : cn;
                if (
                  longer.includes(shorter) &&
                  shorter.length / longer.length >= 0.8
                )
                  return true;
                return false;
              });
            })();

      if (hit) {
        citedKind = "paper";
        citedId = hit.id;
        matchMethod = "title-fuzzy";
      } else {
        citedKind = "reference";
        citedId = String(ref.id);
        matchMethod = "manual";
      }
    }

    // If we ended on reference fallback, choose a non-'manual' provenance —
    // 'manual' is reserved for user-edited rows. Use the original signal.
    if (citedKind === "reference") {
      matchMethod = ref.doi ? "doi" : ref.title ? "title-fuzzy" : "manual";
    }

    try {
      const inserted = await db
        .insert(paperCitations)
        .values({
          citerKind: "paper",
          citerId: paperId,
          citedKind,
          citedId,
          sourceMarkerIdx: ref.markerIndex ?? null,
          matchMethod,
        })
        .onConflictDoNothing()
        .returning({ id: paperCitations.id });
      linked += inserted.length;
    } catch (err) {
      if (isMissingRelationError(err)) {
        console.warn(
          "[auto-link] paper_citations table missing, skipping",
          err,
        );
        return { linked: 0 };
      }
      console.warn("[auto-link] insert failed for ref", ref.id, err);
    }
  }

  return { linked };
}
