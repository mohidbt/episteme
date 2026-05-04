import { db } from "@episteme/db/client";
import { sql } from "drizzle-orm";
import { rowsOf } from "@/lib/db/rows";
import type { GraphEdge, GraphNode } from "./types";

export async function edgesPaperIsRef(userId: string): Promise<GraphEdge[]> {
  const r = await db.execute(sql`
    SELECT p.id AS paper_id, r.id AS ref_id
    FROM "references" r JOIN papers p ON p.id = r.paper_id
    WHERE r.user_id = ${userId} AND r.paper_id IS NOT NULL
  `);
  return rowsOf<{ paper_id: string; ref_id: string }>(r).map((x) => ({
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
