// Helpers for /api/references: unique-collision suggestion + 23505 detection.

import { db } from "./db";
import { references_ } from "@episteme/db/schema";

/**
 * Given a citation key, produce the next "-N" suggestion.
 * - "foo"     -> "foo-2"
 * - "foo-2"   -> "foo-3"
 * - "foo-10"  -> "foo-11"
 */
export function suggestNextCitationKey(key: string): string {
  const m = key.match(/^(.+)-(\d+)$/);
  if (m) {
    const base = m[1];
    const n = Number.parseInt(m[2], 10);
    return `${base}-${n + 1}`;
  }
  return `${key}-2`;
}

/**
 * Detects Postgres unique-violation errors (SQLSTATE 23505).
 *
 * The `postgres` (postgres-js) driver throws PostgresError with `.code` set
 * directly. Drizzle wraps those in its own `DrizzleQueryError` and preserves
 * the original via `.cause`. Check both.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const direct = (err as { code?: unknown }).code;
  if (direct === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "23505") {
    return true;
  }
  return false;
}

type InsertValues = {
  libraryId: number;
  folderPath: string;
  citationKey: string;
  cslJson: unknown;
  paperId?: string | null;
  userId: string;
};

/**
 * Insert a reference row, retrying with bumped citation-key suffixes on 23505
 * collisions. Returns the finally inserted row plus the key actually used
 * (so callers can report bumps). Gives up after `maxAttempts` tries.
 */
export async function insertReferenceWithSuffixBump(
  values: InsertValues,
  maxAttempts = 20,
): Promise<{ row: typeof references_.$inferSelect; finalKey: string; bumped: boolean }> {
  let key = values.citationKey;
  let bumped = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const [row] = await db
        .insert(references_)
        .values({ ...values, citationKey: key })
        .returning();
      return { row, finalKey: key, bumped };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      key = suggestNextCitationKey(key);
      bumped = true;
    }
  }
  throw new Error(`citation_key_suffix_exhausted after ${maxAttempts} attempts`);
}
