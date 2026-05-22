import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// D7.4 — enrich the references panel with per-row paper match + edge counts.
//
// Three small queries, run once per references panel render:
//   1) DOI → paper_id map (user-scoped) so we can auto-promote a ref to a
//      paper card whose target is the user's own paper.
//   2) Cited-in counts grouped by cited_id  (cited_kind='reference').
//   3) Citing  counts grouped by citer_id   (citer_kind='reference').
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

  // 2) citedIn counts: rows where cited_kind='reference' AND cited_id ∈ refIds
  const citedInRes = await db.execute(sql`
    SELECT cited_id, COUNT(*)::int AS n
    FROM paper_citations
    WHERE cited_kind = 'reference'
      AND cited_id IN (${sql.join(refIdStrings.map((id) => sql`${id}`), sql`, `)})
    GROUP BY cited_id
  `);
  const citedInRowsRaw = (citedInRes as { rows?: unknown[] }).rows ?? (citedInRes as unknown as unknown[]);
  const citedInRows = Array.isArray(citedInRowsRaw) ? citedInRowsRaw : [];
  const citedInMap = new Map<string, number>();
  for (const row of citedInRows as Array<{ cited_id: string; n: number | string }>) {
    citedInMap.set(String(row.cited_id), toNumber(row.n));
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
    citedInCount: citedInMap.get(String(r.id)) ?? 0,
    citingCount: citingMap.get(String(r.id)) ?? 0,
  }));
}
