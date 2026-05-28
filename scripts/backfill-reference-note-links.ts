/**
 * One-shot backfill for note_links rows with target_kind='reference' AND
 * target_id IS NULL.
 *
 * Why this exists: prior to the N6 v5 fix in
 * packages/notes-core/src/rebuild-links.ts, the resolver only matched
 * `[[r:...]]` raw against references_.citation_key. The slash typeahead
 * persists `[[r:<title>]]`, so most reference links landed unresolved.
 *
 * This script re-runs the title-based lookup against the same user's
 * references_ table and updates target_id where a unique case-insensitive
 * cslJson.title match exists. Idempotent — running again is a no-op once
 * resolved.
 *
 * Safe by construction:
 *   - Only updates rows where target_id IS NULL (never overwrites).
 *   - Scopes by source note's user_id (no cross-user resolution).
 *   - Skips ambiguous titles (multiple references with the same title).
 *
 * Run:
 *   pnpm exec tsx scripts/backfill-reference-note-links.ts            # all users
 *   pnpm exec tsx scripts/backfill-reference-note-links.ts <userId>   # one user
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@episteme/db";
import { noteLinks, notes, references_ } from "@episteme/db/schema";

async function backfill(filterUserId?: string): Promise<void> {
  // Pull unresolved reference links + their source-note user_id.
  const rows = await db
    .select({
      linkId: noteLinks.id,
      raw: noteLinks.targetTitleRaw,
      userId: notes.userId,
    })
    .from(noteLinks)
    .innerJoin(notes, eq(noteLinks.sourceNoteId, notes.id))
    .where(
      and(
        eq(noteLinks.targetKind, "reference"),
        isNull(noteLinks.targetId),
        filterUserId ? eq(notes.userId, filterUserId) : sql`TRUE`,
      ),
    );

  console.log(`[backfill] unresolved reference links: ${rows.length}`);

  let updated = 0;
  let ambiguous = 0;
  let stillUnresolved = 0;

  for (const row of rows) {
    const rawLower = row.raw.toLowerCase();

    // Title match (case-insensitive on cslJson.title) OR citation_key match.
    const matches = await db
      .select({ id: references_.id })
      .from(references_)
      .where(
        and(
          eq(references_.userId, row.userId),
          sql`(lower(${references_.cslJson}->>'title') = ${rawLower} OR ${references_.citationKey} = ${row.raw})`,
        ),
      );

    if (matches.length === 0) {
      stillUnresolved++;
      continue;
    }
    if (matches.length > 1) {
      ambiguous++;
      console.warn(
        `[backfill] ambiguous: ${matches.length} references match "${row.raw}" for user ${row.userId} — skipping`,
      );
      continue;
    }

    await db
      .update(noteLinks)
      .set({ targetId: matches[0].id })
      .where(eq(noteLinks.id, row.linkId));
    updated++;
  }

  console.log(
    `[backfill] done — updated=${updated} ambiguous=${ambiguous} stillUnresolved=${stillUnresolved}`,
  );
}

const userId = process.argv[2];
backfill(userId).then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
