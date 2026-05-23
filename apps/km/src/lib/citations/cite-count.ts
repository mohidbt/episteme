import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// H-batch Step 7-8: cross-library cite count.
//
// For each input docRefId, count distinct OTHER user-library papers that
// cite the same underlying work (DOI / pg_trgm title fuzzy ≥ 0.6). Excludes
// the source paper itself — "Cited in 1" on every card is trivial noise.
// The renderer hides the badge when count is 0; only shows when ≥1 OTHER
// library paper also bibliographically cites this identity.
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
  // Count DISTINCT b.paper_id where b.paper_id != a.paper_id — i.e. OTHER
  // library papers that cite the same identity. Self-paper exclusion makes
  // the count meaningful: 0 = unique to this paper, ≥1 = shared with N others.
  const fuzzyQuery = sql`
    SELECT a.id AS input_id, COUNT(DISTINCT b.paper_id)::int AS n
    FROM document_references a
    JOIN papers pa ON pa.id = a.paper_id AND pa.user_id = ${userId}
    JOIN document_references b ON b.paper_id != a.paper_id
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
    JOIN document_references b ON b.paper_id != a.paper_id
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
