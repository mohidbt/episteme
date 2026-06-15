// Helpers for /api/references: unique-collision suggestion + 23505 detection.

import { db } from "./db";
import { references_ } from "@episteme/db/schema";
import { isUniqueViolation } from "./pg-errors";

export { isUniqueViolation };

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

type InsertValues = {
  libraryId: number;
  folderPath: string;
  folderId?: string | null;
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
