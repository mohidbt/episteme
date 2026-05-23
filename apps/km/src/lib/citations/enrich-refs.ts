import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCrossLibraryCiteCounts } from "@/lib/citations/cite-count";

// D7.4 + H-batch Step 7-8 — enrich the references panel with per-row paper
// match + edge counts.
//
// Three small queries, run once per references panel render:
//   1) DOI → paper_id map (user-scoped) so we can auto-promote a ref to a
//      paper card whose target is the user's own paper.
//   2) citedInCount: CROSS-LIBRARY cluster count via getCrossLibraryCiteCounts
//      (Step 7-8). For each docRef in the current paper's bibliography, count
//      distinct papers in the user's library that cite the same underlying
//      work (DOI exact / pg_trgm title fuzzy ≥ 0.6). The count includes the
//      source paper itself, so a uniquely-cited ref shows 1.
//   3) Citing counts grouped by citer_id (citer_kind='reference').
//
// We deliberately use db.execute(sql`...`) rather than the query-builder so
// the IN-list parametrization stays simple for arbitrary-length ref arrays.

export interface RefInput {
  id: number;
  doi: string | null;
}

export interface EnrichedRef extends RefInput {
  matchedPaperId: string | null;
  citedInCount: number;
  citingCount: number;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function enrichRefsWithPaperMatchAndEdges<T extends RefInput>(
  refs: T[],
  userId: string,
): Promise<(T & { matchedPaperId: string | null; citedInCount: number; citingCount: number })[]> {
  if (refs.length === 0) return [];

  const refIds = refs.map((r) => r.id);
  const refIdStrings = refIds.map((id) => String(id));
  const dois = refs
    .map((r) => r.doi)
    .filter((d): d is string => typeof d === "string" && d.length > 0);

  const doiToPaper = new Map<string, string>();
  if (dois.length > 0) {
    const doiMapRes = await db.execute(sql`
      SELECT doi, id AS paper_id
      FROM papers
      WHERE user_id = ${userId}
        AND doi IN (${sql.join(dois.map((doi) => sql`${doi}`), sql`, `)})
    `);
    const doiRowsRaw = (doiMapRes as { rows?: unknown[] }).rows ?? (doiMapRes as unknown as unknown[]);
    const doiRows = Array.isArray(doiRowsRaw) ? doiRowsRaw : [];
    for (const row of doiRows as Array<{ doi: string; paper_id: string }>) {
      if (row?.doi && row?.paper_id) doiToPaper.set(row.doi, row.paper_id);
    }
  }

  // 2) citedIn counts — H-batch Step 7-8: cross-library cluster count.
  // For each docRef in this paper's bib, count distinct papers in the user's
  // library that cite the same underlying work (DOI exact / pg_trgm title
  // fuzzy ≥ 0.6). Best-effort: if the cluster query fails (missing pg_trgm
  // in a way the helper didn't catch), fall back to 0 for all rows.
  let citedInMap: Map<number, number>;
  try {
    citedInMap = await getCrossLibraryCiteCounts(userId, refIds);
  } catch (err) {
    console.warn("[enrich-refs] cross-library cite count failed", err);
    citedInMap = new Map();
  }

  // 3) citing counts: rows where citer_kind='reference' AND citer_id ∈ refIds
  const citingRes = await db.execute(sql`
    SELECT citer_id, COUNT(*)::int AS n
    FROM paper_citations
    WHERE citer_kind = 'reference'
      AND citer_id IN (${sql.join(refIdStrings.map((id) => sql`${id}`), sql`, `)})
    GROUP BY citer_id
  `);
  const citingRowsRaw = (citingRes as { rows?: unknown[] }).rows ?? (citingRes as unknown as unknown[]);
  const citingRows = Array.isArray(citingRowsRaw) ? citingRowsRaw : [];
  const citingMap = new Map<string, number>();
  for (const row of citingRows as Array<{ citer_id: string; n: number | string }>) {
    citingMap.set(String(row.citer_id), toNumber(row.n));
  }

  return refs.map((r) => ({
    ...r,
    matchedPaperId: r.doi ? doiToPaper.get(r.doi) ?? null : null,
    citedInCount: citedInMap.get(r.id) ?? 0,
    citingCount: citingMap.get(String(r.id)) ?? 0,
  }));
}
