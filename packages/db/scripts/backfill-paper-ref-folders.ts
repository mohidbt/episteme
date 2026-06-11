/**
 * GSD-76 backfill: align each hidden ref-twin's folder location with its
 * paper. Refs auto-created from paper upload before this fix landed at root
 * (folder_id NULL, folder_path ""), even when the paper sat in a drive
 * folder. This script copies papers.folder_id / papers.folder_path onto the
 * twin reference identified by references_.paper_id = papers.id.
 *
 * Idempotent: only updates rows where the ref's folder_id differs from the
 * paper's folder_id (so re-runs are no-ops once consistent).
 *
 * Usage:
 *   pnpm --filter @episteme/db exec tsx scripts/backfill-paper-ref-folders.ts
 *
 * Env:
 *   OWNER_DATABASE_URL / MIGRATE_DATABASE_URL / DATABASE_URL — Postgres DSN
 *   with UPDATE on `references`.
 *
 * SAFETY: writes to DB. DRY_RUN=1 prints candidate counts without writing.
 */

import postgres from "postgres";

interface CandidateRow {
  ref_id: string;
  paper_id: string;
  ref_folder_id: string | null;
  paper_folder_id: string | null;
  paper_folder_path: string;
}

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
    // Candidates: twin refs whose folder doesn't match their paper.
    // IS DISTINCT FROM treats NULLs as comparable so we catch null<->uuid drift.
    const rows = (await sql<CandidateRow[]>`
      SELECT r.id AS ref_id,
             p.id AS paper_id,
             r.folder_id AS ref_folder_id,
             p.folder_id AS paper_folder_id,
             p.folder_path AS paper_folder_path
      FROM "references" r
      JOIN papers p ON p.id = r.paper_id
      WHERE r.folder_id IS DISTINCT FROM p.folder_id
         OR r.folder_path IS DISTINCT FROM p.folder_path
    `) as unknown as CandidateRow[];

    console.log(
      `backfill-paper-ref-folders: ${rows.length} ref-twin(s) to align (dryRun=${dryRun})`,
    );
    if (rows.length > 0) {
      const sample = rows.slice(0, 5).map((r) => ({
        ref: r.ref_id,
        paper: r.paper_id,
        from: r.ref_folder_id,
        to: r.paper_folder_id,
        path: r.paper_folder_path,
      }));
      console.log("sample:", JSON.stringify(sample, null, 2));
    }

    if (dryRun) return;

    let updated = 0;
    for (const row of rows) {
      await sql`
        UPDATE "references"
        SET folder_id = ${row.paper_folder_id},
            folder_path = ${row.paper_folder_path}
        WHERE id = ${row.ref_id}
      `;
      updated++;
    }
    console.log(`backfill-paper-ref-folders: updated=${updated}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
