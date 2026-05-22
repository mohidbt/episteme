import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  paperCitations,
  papers,
  references_,
} from "@episteme/db/schema";

// G2/Bug-2c: list of papers that cite a given references_ row (uuid).
//
// IMPORTANT: paper_citations.cited_id is TEXT polymorphic. For
// cited_kind='reference' rows, the D2 auto-link writer
// (apps/km/src/lib/citations/auto-link.ts) stores
//   cited_id = String(document_references.id)        // serial int as text
// NOT the references_.id UUID. So we cannot filter by referenceId directly.
//
// Resolution strategy (mirrors auto-link):
//   1. Load the references_ row (scoped to userId), pull cslJson.DOI / .title.
//   2. Find document_references rows whose paper is owned by userId AND whose
//      doi matches (case-insensitive) — OR, if no DOI, whose title fuzzy-
//      matches via pg_trgm above FUZZY_SIM_THRESHOLD.
//   3. Stringify those document_references.id ints and look up paper_citations
//      WHERE cited_kind='reference' AND cited_id IN (...) AND citer_kind='paper'.
//   4. Join papers (gated by userId) for the citer title.
//
// pg_trgm missing → degrade title-fuzzy to no-op (mirrors auto-link.ts).

export interface ReferenceCitedInRow {
  edgeId: number;
  paperId: string;
  title: string | null;
  markerIdx: number | null;
}

// Mirror of auto-link.ts FUZZY_SIM_THRESHOLD — both writer and reader must
// agree, otherwise edges written at 0.6 wouldn't resolve back.
const FUZZY_SIM_THRESHOLD = 0.6;

function isPgTrgmMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Drizzle wraps the underlying pg error as `.cause`; postgres-js sometimes
  // exposes `.code` directly on the thrown error. Inspect both message AND
  // cause.message so the "Failed query" outer wrapper doesn't mask the
  // 42883 (undefined_function) / 42704 (undefined_object) detail.
  const causeMsg = err.cause instanceof Error ? err.cause.message : "";
  const msg = `${err.message} ${causeMsg}`.toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("operator") || msg.includes("similarity") || msg.includes("pg_trgm"))
  );
}

async function findUserDocRefsByTitle(
  userId: string,
  title: string,
): Promise<number[]> {
  try {
    const result = await db.execute(sql`
      SELECT dr.id
      FROM document_references dr
      INNER JOIN papers p ON p.id = dr.paper_id
      WHERE p.user_id = ${userId}
        AND dr.title IS NOT NULL
        AND dr.title % ${title}
        AND similarity(dr.title, ${title}) >= ${FUZZY_SIM_THRESHOLD}
    `);
    const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
    const list = Array.isArray(rows) ? rows : [];
    return list
      .map((r) => (r as { id?: number | string }).id)
      .filter((v): v is number | string => v != null)
      .map((v) => (typeof v === "string" ? parseInt(v, 10) : v))
      .filter((n) => Number.isFinite(n));
  } catch (err) {
    if (isPgTrgmMissingError(err)) {
      console.warn(
        "[reference-cited-in] pg_trgm not available; skipping fuzzy title match",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
    throw err;
  }
}

export async function getReferenceCitedIn(
  referenceId: string,
  userId: string,
): Promise<ReferenceCitedInRow[]> {
  // 1. Load references_ row scoped to user. Cross-user isolation: if the
  //    reference belongs to someone else, this returns [] and we exit early.
  const refRows = await db
    .select({ cslJson: references_.cslJson })
    .from(references_)
    .where(and(eq(references_.id, referenceId), eq(references_.userId, userId)))
    .limit(1);

  if (refRows.length === 0) return [];

  const csl = (refRows[0].cslJson ?? {}) as Record<string, unknown>;
  const doi = typeof csl.DOI === "string" ? csl.DOI.trim() : null;
  const title = typeof csl.title === "string" ? csl.title.trim() : null;

  // 2. Collect document_references.id ints scoped to the user's papers.
  const docRefIds = new Set<number>();

  if (doi) {
    const hits = await db
      .select({ id: documentReferences.id })
      .from(documentReferences)
      .innerJoin(papers, eq(papers.id, documentReferences.paperId))
      .where(
        and(
          eq(papers.userId, userId),
          // Case-insensitive DOI match
          eq(sql`lower(${documentReferences.doi})`, doi.toLowerCase()),
        ),
      );
    for (const h of hits) docRefIds.add(h.id);
  } else if (title) {
    const ids = await findUserDocRefsByTitle(userId, title);
    for (const id of ids) docRefIds.add(id);
  }

  if (docRefIds.size === 0) return [];

  // 3. Stringified id list for cited_id (text) IN-clause.
  const citedIdStrings = Array.from(docRefIds).map((n) => String(n));

  // 4. paper_citations + papers join (userId-gated).
  const rows = await db
    .select({
      edgeId: paperCitations.id,
      paperId: papers.id,
      title: papers.title,
      markerIdx: paperCitations.sourceMarkerIdx,
    })
    .from(paperCitations)
    .innerJoin(
      papers,
      and(
        eq(sql`${papers.id}::text`, paperCitations.citerId),
        eq(papers.userId, userId),
      ),
    )
    .where(
      and(
        eq(paperCitations.citerKind, "paper"),
        eq(paperCitations.citedKind, "reference"),
        inArray(paperCitations.citedId, citedIdStrings),
      ),
    )
    .orderBy(asc(paperCitations.sourceMarkerIdx), asc(paperCitations.id));

  return rows as ReferenceCitedInRow[];
}
