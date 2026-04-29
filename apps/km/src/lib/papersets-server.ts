import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// postgres-js's drizzle returns row arrays directly (array-like).
// Some callers/tests have seen `.rows` shapes; normalize defensively.
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = (result as { rows?: unknown[] }).rows;
  return (r ?? []) as T[];
}

export async function papersetCountForPaper(
  paperId: string,
  userId: string,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM papersets ps
    LEFT JOIN folders f ON ps.folder_id = f.id
    WHERE ps.user_id = ${userId}
      AND (f.is_trash IS NULL OR f.is_trash = false)
      AND ps.row_refs @> jsonb_build_array(jsonb_build_object('paper_id', ${paperId}::text))
  `);
  const rows = toRows<{ n: number }>(result);
  return rows[0]?.n ?? 0;
}

export async function papersetsForPaper(
  paperId: string,
  userId: string,
): Promise<Array<{ id: string; filename: string }>> {
  const result = await db.execute(sql`
    SELECT ps.id, ps.filename
    FROM papersets ps
    LEFT JOIN folders f ON ps.folder_id = f.id
    WHERE ps.user_id = ${userId}
      AND (f.is_trash IS NULL OR f.is_trash = false)
      AND ps.row_refs @> jsonb_build_array(jsonb_build_object('paper_id', ${paperId}::text))
    ORDER BY ps.updated_at DESC
  `);
  return toRows<{ id: string; filename: string }>(result);
}
