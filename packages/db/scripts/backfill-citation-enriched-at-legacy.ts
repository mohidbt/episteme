/**
 * GSD-74 follow-up backfill: stamp `enriched_at` on legacy document_references
 * rows that were enriched under the round-2 path (`enrichPaperReferencesInDb`)
 * before `enrichedAt` was wired up.
 *
 * Symptom this resolves: chip render gates on `enrichedAt == null && doi != null`,
 * so already-enriched legacy rows render a stuck "enrich" chip forever.
 *
 * Idempotent. Only updates rows where enriched_at IS NULL AND at least one
 * enriched field (semantic_scholar_id, citation_count, venue, abstract) is
 * populated. Safe to re-run.
 *
 * Usage:
 *   pnpm --filter @episteme/db exec tsx scripts/backfill-citation-enriched-at-legacy.ts
 *
 * Env:
 *   OWNER_DATABASE_URL or MIGRATE_DATABASE_URL — Postgres DSN with UPDATE on
 *   document_references.
 *   DRY_RUN=1 — count candidates without writing.
 *
 * SAFETY: writes to DB. Default is wet-run; pass DRY_RUN=1 for a preview.
 */

import postgres from "postgres";

async function main() {
  const dsn =
    process.env.OWNER_DATABASE_URL ??
    process.env.MIGRATE_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!dsn) {
    console.error(
      "OWNER_DATABASE_URL / MIGRATE_DATABASE_URL / DATABASE_URL required",
    );
    process.exit(1);
  }
  const dryRunRaw = (process.env.DRY_RUN ?? "").toLowerCase();
  const dryRun = dryRunRaw === "1" || dryRunRaw === "true" || dryRunRaw === "yes";
  const sql = postgres(dsn, { max: 1, prepare: false });

  try {
    const candidates = (await sql`
      SELECT COUNT(*)::int AS n
      FROM document_references
      WHERE enriched_at IS NULL
        AND (
          semantic_scholar_id IS NOT NULL
          OR citation_count IS NOT NULL
          OR venue IS NOT NULL
          OR abstract IS NOT NULL
        )
    `) as unknown as { n: number }[];
    const count = candidates[0]?.n ?? 0;

    console.log(
      `backfill-citation-enriched-at-legacy: ${count} candidate rows (dryRun=${dryRun})`,
    );

    if (dryRun || count === 0) {
      return;
    }

    const updated = (await sql`
      UPDATE document_references
      SET enriched_at = NOW()
      WHERE enriched_at IS NULL
        AND (
          semantic_scholar_id IS NOT NULL
          OR citation_count IS NOT NULL
          OR venue IS NOT NULL
          OR abstract IS NOT NULL
        )
      RETURNING id
    `) as unknown as { id: string }[];

    console.log(
      `backfill-citation-enriched-at-legacy: stamped enriched_at on ${updated.length} rows`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
