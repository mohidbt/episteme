/**
 * GSD-50 tour-record helper: reset extracted citation rows for a single paper
 * so the wow_citations.webm scene can re-trigger the live "Find citations"
 * flow.
 *
 * Deletes (scoped to one paper_id):
 *   - document_references (markers + kept_citations cascade via FK)
 *   - paper_citations rows where this paper is the citer
 *
 * Preserves:
 *   - papers row
 *   - references_ ref-twin (paperId-bound row from GSD-32)
 *
 * Usage:
 *   pnpm --filter @episteme/db exec tsx scripts/reset-paper-citations.ts <paperId>
 *
 * Env:
 *   DATABASE_URL — Postgres DSN with DELETE on the three tables above.
 *   DRY_RUN=1    — print counts only, no deletes.
 */
import postgres from "postgres";

async function main() {
  const paperId = process.argv[2];
  if (!paperId) {
    console.error("usage: tsx reset-paper-citations.ts <paperId>");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  const dryRun = process.env.DRY_RUN === "1";
  const sql = postgres(url);

  try {
    const [paper] = await sql<{ id: string; title: string | null; chandra_status: string | null }[]>`
      SELECT id, title, chandra_status FROM papers WHERE id = ${paperId}
    `;
    if (!paper) {
      console.error(`paper ${paperId} not found`);
      process.exit(1);
    }
    console.log("paper:", paper);

    const [{ refs }] = await sql<{ refs: number }[]>`
      SELECT COUNT(*)::int AS refs FROM document_references WHERE paper_id = ${paperId}
    `;
    const [{ markers }] = await sql<{ markers: number }[]>`
      SELECT COUNT(*)::int AS markers
      FROM document_reference_markers m
      JOIN document_references r ON m.reference_id = r.id
      WHERE r.paper_id = ${paperId}
    `;
    const [{ pc }] = await sql<{ pc: number }[]>`
      SELECT COUNT(*)::int AS pc FROM paper_citations
      WHERE citer_kind = 'paper' AND citer_id = ${paperId}
    `;
    const [{ kept }] = await sql<{ kept: number }[]>`
      SELECT COUNT(*)::int AS kept FROM kept_citations k
      JOIN document_references r ON k.document_reference_id = r.id
      WHERE r.paper_id = ${paperId}
    `;
    const [{ twins }] = await sql<{ twins: number }[]>`
      SELECT COUNT(*)::int AS twins FROM "references" WHERE paper_id = ${paperId}
    `;

    console.log("BEFORE counts:", {
      document_references: refs,
      document_reference_markers: markers,
      paper_citations_citer: pc,
      kept_citations: kept,
      references_twin_preserve: twins,
    });

    if (dryRun) {
      console.log("DRY_RUN=1 — no deletes");
      return;
    }

    await sql.begin(async (tx) => {
      const dPC = await tx`
        DELETE FROM paper_citations
        WHERE citer_kind = 'paper' AND citer_id = ${paperId}
      `;
      // document_reference_markers AND kept_citations cascade via FK
      // ON DELETE CASCADE — single DELETE clears all three.
      const dRefs = await tx`DELETE FROM document_references WHERE paper_id = ${paperId}`;
      console.log("deleted:", {
        paper_citations: dPC.count,
        document_references: dRefs.count,
      });
    });

    const [{ refsAfter }] = await sql<{ refsAfter: number }[]>`
      SELECT COUNT(*)::int AS "refsAfter" FROM document_references WHERE paper_id = ${paperId}
    `;
    const [{ twinsAfter }] = await sql<{ twinsAfter: number }[]>`
      SELECT COUNT(*)::int AS "twinsAfter" FROM "references" WHERE paper_id = ${paperId}
    `;
    console.log("AFTER counts:", {
      document_references: refsAfter,
      references_twin: twinsAfter,
    });
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
