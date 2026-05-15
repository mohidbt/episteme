import { eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { assets, notes, papers } from "@episteme/db/schema";

export const LIBRARY_BYTES_LIMIT = 100 * 1024 * 1024; // 100 MB

export interface LibraryUsage {
  papers: number;
  notes: number;
  assets: number;
  total: number;
}

/**
 * Sum size_bytes across papers, notes, and assets for a single library.
 * Three independent SUM queries — small enough that joining is overkill,
 * and keeps each kind's NULL→0 coercion local to its table.
 */
export async function getLibraryUsageBytes(
  libraryId: number,
): Promise<LibraryUsage> {
  const sumExpr = (col: AnyPgColumn): SQL<number> =>
    sql<number>`COALESCE(SUM(${col}), 0)::bigint`;

  const [p] = await db
    .select({ total: sumExpr(papers.sizeBytes) })
    .from(papers)
    .where(eq(papers.libraryId, libraryId));
  const [n] = await db
    .select({ total: sumExpr(notes.sizeBytes) })
    .from(notes)
    .where(eq(notes.libraryId, libraryId));
  const [a] = await db
    .select({ total: sumExpr(assets.sizeBytes) })
    .from(assets)
    .where(eq(assets.libraryId, libraryId));

  // postgres-js returns SUM as string for bigint; normalize to number.
  const papersBytes = Number(p?.total ?? 0);
  const notesBytes = Number(n?.total ?? 0);
  const assetsBytes = Number(a?.total ?? 0);

  return {
    papers: papersBytes,
    notes: notesBytes,
    assets: assetsBytes,
    total: papersBytes + notesBytes + assetsBytes,
  };
}

export type LibraryLimitCheck =
  | { ok: true; usedBytes: number; limitBytes: number }
  | { ok: false; usedBytes: number; limitBytes: number };

/**
 * Gate-side helper for write paths: returns ok=false when the incoming
 * upload would push the library past LIBRARY_BYTES_LIMIT. Callers map
 * ok=false → HTTP 413 { error: "over_limit", usedBytes, limitBytes }.
 *
 * "Over" is strict: used + incoming <= limit is allowed. Equal-to-limit
 * is the boundary case (you can fit exactly 100 MB).
 */
export async function assertWithinLibraryLimit(
  libraryId: number,
  incomingBytes: number,
): Promise<LibraryLimitCheck> {
  const usage = await getLibraryUsageBytes(libraryId);
  const ok = usage.total + incomingBytes <= LIBRARY_BYTES_LIMIT;
  return { ok, usedBytes: usage.total, limitBytes: LIBRARY_BYTES_LIMIT };
}
