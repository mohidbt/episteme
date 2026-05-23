import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// H-batch Step 7-8: cross-library cite count.
//
// For each input docRefId, count distinct user-library papers that cite the
// *same underlying work* (DOI exact / pg_trgm title fuzzy ≥ 0.6) — not just
// that specific docRef. This widens the citedInCount shown on paper cite
// cards: if both paper A and paper B in the user's library cite DOI X, the
// docRef on each card shows count = 2 (the cluster of citers in the user's
// library).
//
// The query joins document_references to itself (a, b) by:
//   - both belong to papers owned by userId
//   - a.id ∈ input
//   - identity match between a and b on DOI (case/whitespace tolerant) OR
//     pg_trgm title fuzzy ≥ FUZZY_SIM_THRESHOLD
// Then groups by a.id, counting DISTINCT b.paper_id.
//
// pg_trgm-missing degrades to DOI-only path (matches auto-link.ts).

const FUZZY_SIM_THRESHOLD = 0.6;

function isPgTrgmMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const causeMsg = err.cause instanceof Error ? err.cause.message : "";
  const msg = `${err.message} ${causeMsg}`.toLowerCase();
  return (
    msg.includes("does not exist") &&
    (msg.includes("operator") || msg.includes("similarity") || msg.includes("pg_trgm"))
  );
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function getCrossLibraryCiteCounts(
  userId: string,
  docRefIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (docRefIds.length === 0) return out;

  const idList = sql.join(
    docRefIds.map((id) => sql`${id}`),
    sql`, `,
  );

  // Self-join document_references (a = input row, b = peer row in the same
  // user's library, possibly a itself). Count distinct b.paper_id per a.id.
  // a.id is the *input* docRefId; we report counts back keyed on a.id even
  // though b.paper_id is what gets counted.
  const fuzzyQuery = sql`
    SELECT a.id AS input_id, COUNT(DISTINCT b.paper_id)::int AS n
    FROM document_references a
    JOIN papers pa ON pa.id = a.paper_id AND pa.user_id = ${userId}
    JOIN document_references b ON b.id != a.id OR b.id = a.id
    JOIN papers pb ON pb.id = b.paper_id AND pb.user_id = ${userId}
    WHERE a.id IN (${idList})
      AND (
        (a.doi IS NOT NULL AND b.doi IS NOT NULL
         AND lower(trim(a.doi)) = lower(trim(b.doi)))
        OR
        (a.title IS NOT NULL AND b.title IS NOT NULL
         AND a.title % b.title
         AND similarity(a.title, b.title) >= ${FUZZY_SIM_THRESHOLD})
      )
    GROUP BY a.id
  `;

  const doiOnlyQuery = sql`
    SELECT a.id AS input_id, COUNT(DISTINCT b.paper_id)::int AS n
    FROM document_references a
    JOIN papers pa ON pa.id = a.paper_id AND pa.user_id = ${userId}
    JOIN document_references b ON TRUE
    JOIN papers pb ON pb.id = b.paper_id AND pb.user_id = ${userId}
    WHERE a.id IN (${idList})
      AND a.doi IS NOT NULL AND b.doi IS NOT NULL
      AND lower(trim(a.doi)) = lower(trim(b.doi))
    GROUP BY a.id
  `;

  let result;
  try {
    result = await db.execute(fuzzyQuery);
  } catch (err) {
    if (isPgTrgmMissingError(err)) {
      console.warn(
        "[cite-count] pg_trgm not available; using DOI-only cluster",
        err instanceof Error ? err.message : err,
      );
      result = await db.execute(doiOnlyQuery);
    } else {
      throw err;
    }
  }

  const rowsRaw = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  for (const row of rows as Array<{ input_id: number | string; n: number | string }>) {
    if (row?.input_id == null) continue;
    const key = typeof row.input_id === "string" ? parseInt(row.input_id, 10) : row.input_id;
    if (!Number.isFinite(key)) continue;
    out.set(key, toNumber(row.n));
  }
  return out;
}
