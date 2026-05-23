import { db } from "@episteme/db/client";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/lib/db/rows";
import type { GraphEdge, GraphNode } from "./types";

// Identity threshold for fuzzy title match (mirror of auto-link's
// FUZZY_SIM_THRESHOLD). Empirically tuned so paraphrased / punctuation-
// varied titles still pass while short shared prefixes don't.
const PAPER_IS_REF_FUZZY_SIM_THRESHOLD = 0.6;

function isPgTrgmMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("operator") || msg.includes("similarity") || msg.includes("pg_trgm"))
  );
}

// paper_is_ref now means IDENTITY (paper IS the same entity as a reference),
// not "paper has reference in bibliography". Source: DOI exact match between
// papers.doi and references.csl_json->>'DOI', OR pg_trgm fuzzy title match
// between papers.title and references.csl_json->>'title' ≥ 0.6.
//
// Note: the legacy references.paper_id column is intentionally ignored —
// it is reserved for the future "PDF attached to reference" workflow and no
// longer drives graph edges. See plan H-batch.
//
// pg_trgm-missing errors degrade silently to "no fuzzy hits" so the DOI path
// still emits edges (matches auto-link.ts behaviour).
export async function edgesPaperIsRef(userId: string): Promise<GraphEdge[]> {
  const query = sql`
    SELECT DISTINCT ON (r.id)
           p.id AS paper_id, r.id AS ref_id
    FROM papers p, "references" r
    WHERE p.user_id = ${userId} AND r.user_id = ${userId}
      AND (
        (p.doi IS NOT NULL AND r.csl_json->>'DOI' IS NOT NULL
         AND lower(trim(p.doi)) = lower(trim(r.csl_json->>'DOI')))
        OR
        (p.title IS NOT NULL AND r.csl_json->>'title' IS NOT NULL
         AND p.title % (r.csl_json->>'title')
         AND similarity(p.title, r.csl_json->>'title') >= ${PAPER_IS_REF_FUZZY_SIM_THRESHOLD})
      )
    ORDER BY r.id, similarity(COALESCE(p.title, ''), COALESCE(r.csl_json->>'title', '')) DESC NULLS LAST
    LIMIT 5000
  `;
  let result;
  try {
    result = await db.execute(query);
  } catch (err) {
    if (isPgTrgmMissingError(err)) {
      // pg_trgm absent: fall back to DOI-only identity join.
      console.warn(
        "[live-edges] pg_trgm not available; paper_is_ref using DOI-only path",
        err instanceof Error ? err.message : err,
      );
      result = await db.execute(sql`
        SELECT DISTINCT ON (r.id)
               p.id AS paper_id, r.id AS ref_id
        FROM papers p, "references" r
        WHERE p.user_id = ${userId} AND r.user_id = ${userId}
          AND p.doi IS NOT NULL AND r.csl_json->>'DOI' IS NOT NULL
          AND lower(trim(p.doi)) = lower(trim(r.csl_json->>'DOI'))
        ORDER BY r.id
        LIMIT 5000
      `);
    } else {
      throw err;
    }
  }
  return rowsOf<{ paper_id: string; ref_id: string }>(result).map((x) => ({
    src: { kind: "paper", id: x.paper_id },
    dst: { kind: "reference", id: x.ref_id },
    kind: "paper_is_ref",
    weight: 1,
  }));
}

export async function edgesWikiLink(userId: string): Promise<GraphEdge[]> {
  const r = await db.execute(sql`
    SELECT nl.source_note_id, nl.target_kind, nl.target_id
    FROM note_links nl
    JOIN notes n ON n.id = nl.source_note_id
    WHERE n.user_id = ${userId} AND nl.target_id IS NOT NULL
  `);
  return rowsOf<{ source_note_id: string; target_kind: GraphEdge["dst"]["kind"]; target_id: string }>(r).map((x) => ({
    src: { kind: "note", id: x.source_note_id },
    dst: { kind: x.target_kind, id: x.target_id },
    kind: "wiki_link",
    weight: 1,
    meta: { targetKind: x.target_kind },
  }));
}

export async function edgesSharedTag(userId: string): Promise<GraphEdge[]> {
  const r = await db.execute(sql`
    SELECT a.note_id AS a_id, b.note_id AS b_id, COUNT(*)::int AS shared
    FROM note_tags a
    JOIN note_tags b ON a.tag = b.tag AND a.note_id < b.note_id
    JOIN notes na ON na.id = a.note_id AND na.user_id = ${userId}
    JOIN notes nb ON nb.id = b.note_id AND nb.user_id = ${userId}
    GROUP BY a.note_id, b.note_id
  `);
  return rowsOf<{ a_id: string; b_id: string; shared: number }>(r).map((x) => ({
    src: { kind: "note", id: x.a_id },
    dst: { kind: "note", id: x.b_id },
    kind: "shared_tag",
    weight: x.shared,
  }));
}

export async function edgesSemanticSim(userId: string, capPerSrcDstKind = 20): Promise<GraphEdge[]> {
  const r = await db.execute(sql`
    SELECT src_kind, src_id, dst_kind, dst_id, weight FROM (
      SELECT src_kind, src_id, dst_kind, dst_id, weight,
             ROW_NUMBER() OVER (PARTITION BY src_kind, src_id, dst_kind ORDER BY weight DESC) AS rn
      FROM semantic_edges
      WHERE user_id = ${userId}
    ) t WHERE rn <= ${capPerSrcDstKind}
  `);
  return rowsOf<{ src_kind: GraphEdge["src"]["kind"]; src_id: string; dst_kind: GraphEdge["dst"]["kind"]; dst_id: string; weight: number }>(r).map((x) => ({
    src: { kind: x.src_kind, id: x.src_id },
    dst: { kind: x.dst_kind, id: x.dst_id },
    kind: "semantic_sim",
    weight: x.weight,
  }));
}

// Citation edges between papers, plus the widened path that resolves
// paper_citations rows of cited_kind='reference' (pointing at document_references
// rows) onto library references when their DOI / fuzzy title matches a
// references row in the user's library.
//
// Single function emits two unions:
//   1. paper → paper (existing): unchanged.
//   2. paper → reference (new): paper_citations.cited_id is a document_references
//      bigint; we join document_references → references via DOI exact OR
//      pg_trgm title fuzzy ≥ 0.6, both scoped to userId. Truly orphan refs
//      (no library match) are skipped per plan.
//
// Each row produces 2 reciprocal edges (citing + cited_in) mirroring the
// paper↔paper convention.
const PAPER_CITATIONS_FUZZY_SIM_THRESHOLD = 0.6;

export async function edgesPaperCitations(userId: string): Promise<GraphEdge[]> {
  const r = await db.execute(sql`
    SELECT pc.citer_id, pc.cited_id
    FROM paper_citations pc
    JOIN papers ps ON ps.id::text = pc.citer_id AND ps.user_id = ${userId}
    JOIN papers pd ON pd.id::text = pc.cited_id AND pd.user_id = ${userId}
    WHERE pc.citer_kind = 'paper' AND pc.cited_kind = 'paper'
  `);
  const rows = rowsOf<{ citer_id: string; cited_id: string }>(r);
  const edges: GraphEdge[] = [];
  for (const x of rows) {
    edges.push({
      src: { kind: "paper", id: x.citer_id },
      dst: { kind: "paper", id: x.cited_id },
      kind: "citing",
      weight: 1,
    });
    edges.push({
      src: { kind: "paper", id: x.cited_id },
      dst: { kind: "paper", id: x.citer_id },
      kind: "cited_in",
      weight: 1,
    });
  }

  // Widened path: paper_citations rows where cited_kind='reference' point at
  // a document_references id. Resolve to a library references row by DOI /
  // fuzzy title match in the same user's library — AND/OR to a different
  // user paper (Step 9 gap fix): when user uploads paper Y that matches an
  // old docRef X (via DOI/title) in another paper A's bibliography, we must
  // emit citing edge A→Y for the existing paper_citations row of
  // cited_kind='reference', cited_id=docRef.id. We emit BOTH paper-node and
  // ref-node edges when a docRef matches both; the graph view shows both
  // relationships.
  let widenedRefRows: Array<{ paper_id: string; ref_id: string }> = [];
  let widenedPaperRows: Array<{ citer_id: string; cited_paper_id: string }> = [];
  try {
    const w = await db.execute(sql`
      WITH dr_match AS (
        SELECT dr.id::text AS dr_id, r.id AS ref_uuid
        FROM document_references dr
        JOIN papers p ON p.id = dr.paper_id AND p.user_id = ${userId}
        JOIN "references" r ON r.user_id = ${userId} AND (
          (dr.doi IS NOT NULL AND r.csl_json->>'DOI' IS NOT NULL
           AND lower(trim(dr.doi)) = lower(trim(r.csl_json->>'DOI')))
          OR
          (dr.title IS NOT NULL AND r.csl_json->>'title' IS NOT NULL
           AND dr.title % (r.csl_json->>'title')
           AND similarity(dr.title, r.csl_json->>'title') >= ${PAPER_CITATIONS_FUZZY_SIM_THRESHOLD})
        )
      )
      SELECT pc.citer_id AS paper_id, dm.ref_uuid::text AS ref_id
      FROM paper_citations pc
      JOIN dr_match dm ON dm.dr_id = pc.cited_id
      JOIN papers pcheck ON pcheck.id::text = pc.citer_id AND pcheck.user_id = ${userId}
      WHERE pc.citer_kind = 'paper' AND pc.cited_kind = 'reference'
    `);
    widenedRefRows = rowsOf<{ paper_id: string; ref_id: string }>(w);

    // docRef → paper (different user paper than the citer) via DOI/title.
    const wp = await db.execute(sql`
      WITH dr_paper_match AS (
        SELECT DISTINCT dr.id::text AS dr_id, pcand.id::text AS cited_paper_id
        FROM document_references dr
        JOIN papers pciter ON pciter.id = dr.paper_id AND pciter.user_id = ${userId}
        JOIN papers pcand ON pcand.user_id = ${userId} AND pcand.id <> pciter.id AND (
          (dr.doi IS NOT NULL AND pcand.doi IS NOT NULL
           AND lower(trim(dr.doi)) = lower(trim(pcand.doi)))
          OR
          (dr.title IS NOT NULL AND pcand.title IS NOT NULL
           AND dr.title % pcand.title
           AND similarity(dr.title, pcand.title) >= ${PAPER_CITATIONS_FUZZY_SIM_THRESHOLD})
        )
      )
      SELECT pc.citer_id, dpm.cited_paper_id
      FROM paper_citations pc
      JOIN dr_paper_match dpm ON dpm.dr_id = pc.cited_id
      JOIN papers pcheck ON pcheck.id::text = pc.citer_id AND pcheck.user_id = ${userId}
      WHERE pc.citer_kind = 'paper' AND pc.cited_kind = 'reference'
        AND pc.citer_id <> dpm.cited_paper_id
    `);
    widenedPaperRows = rowsOf<{ citer_id: string; cited_paper_id: string }>(wp);
  } catch (err) {
    if (isPgTrgmMissingError(err)) {
      console.warn(
        "[live-edges] pg_trgm not available; edgesPaperCitations using DOI-only widened path",
        err instanceof Error ? err.message : err,
      );
      const w = await db.execute(sql`
        WITH dr_match AS (
          SELECT dr.id::text AS dr_id, r.id AS ref_uuid
          FROM document_references dr
          JOIN papers p ON p.id = dr.paper_id AND p.user_id = ${userId}
          JOIN "references" r ON r.user_id = ${userId}
            AND dr.doi IS NOT NULL AND r.csl_json->>'DOI' IS NOT NULL
            AND lower(trim(dr.doi)) = lower(trim(r.csl_json->>'DOI'))
        )
        SELECT pc.citer_id AS paper_id, dm.ref_uuid::text AS ref_id
        FROM paper_citations pc
        JOIN dr_match dm ON dm.dr_id = pc.cited_id
        JOIN papers pcheck ON pcheck.id::text = pc.citer_id AND pcheck.user_id = ${userId}
        WHERE pc.citer_kind = 'paper' AND pc.cited_kind = 'reference'
      `);
      widenedRefRows = rowsOf<{ paper_id: string; ref_id: string }>(w);

      const wp = await db.execute(sql`
        WITH dr_paper_match AS (
          SELECT DISTINCT dr.id::text AS dr_id, pcand.id::text AS cited_paper_id
          FROM document_references dr
          JOIN papers pciter ON pciter.id = dr.paper_id AND pciter.user_id = ${userId}
          JOIN papers pcand ON pcand.user_id = ${userId} AND pcand.id <> pciter.id
            AND dr.doi IS NOT NULL AND pcand.doi IS NOT NULL
            AND lower(trim(dr.doi)) = lower(trim(pcand.doi))
        )
        SELECT pc.citer_id, dpm.cited_paper_id
        FROM paper_citations pc
        JOIN dr_paper_match dpm ON dpm.dr_id = pc.cited_id
        JOIN papers pcheck ON pcheck.id::text = pc.citer_id AND pcheck.user_id = ${userId}
        WHERE pc.citer_kind = 'paper' AND pc.cited_kind = 'reference'
          AND pc.citer_id <> dpm.cited_paper_id
      `);
      widenedPaperRows = rowsOf<{ citer_id: string; cited_paper_id: string }>(wp);
    } else {
      throw err;
    }
  }
  for (const x of widenedRefRows) {
    edges.push({
      src: { kind: "paper", id: x.paper_id },
      dst: { kind: "reference", id: x.ref_id },
      kind: "citing",
      weight: 1,
    });
    edges.push({
      src: { kind: "reference", id: x.ref_id },
      dst: { kind: "paper", id: x.paper_id },
      kind: "cited_in",
      weight: 1,
    });
  }
  for (const x of widenedPaperRows) {
    edges.push({
      src: { kind: "paper", id: x.citer_id },
      dst: { kind: "paper", id: x.cited_paper_id },
      kind: "citing",
      weight: 1,
    });
    edges.push({
      src: { kind: "paper", id: x.cited_paper_id },
      dst: { kind: "paper", id: x.citer_id },
      kind: "cited_in",
      weight: 1,
    });
  }
  return edges;
}

export async function nodesForUser(userId: string): Promise<GraphNode[]> {
  const ps = await db.execute(sql`SELECT id, title FROM papers WHERE user_id = ${userId}`);
  const ns = await db.execute(sql`SELECT id, title FROM notes  WHERE user_id = ${userId}`);
  const rs = await db.execute(sql`SELECT id, csl_json->>'title' AS title FROM "references" WHERE user_id = ${userId}`);
  return [
    ...rowsOf<{ id: string; title: string | null }>(ps).map((x) => ({ id: x.id, kind: "paper" as const, label: x.title ?? "(untitled paper)" })),
    ...rowsOf<{ id: string; title: string | null }>(ns).map((x) => ({ id: x.id, kind: "note" as const, label: x.title ?? "(untitled note)" })),
    ...rowsOf<{ id: string; title: string | null }>(rs).map((x) => ({ id: x.id, kind: "reference" as const, label: x.title ?? "(untitled reference)" })),
  ];
}
