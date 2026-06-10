/**
 * GSD-80 backfill — strip JATS XML out of `papers.abstract_short`.
 *
 * Companion to `scripts/backfill-jats-abstracts.ts` (which handles
 * `references.csl_json->>'abstract'`). The forward fix in
 * `src/lib/citations/enrich-paper-self.ts` sanitizes new writes via
 * `sanitizeAbstract`; this script remediates pre-fix rows.
 *
 * Usage (dry-run by default):
 *   pnpm --filter km exec tsx scripts/backfill-jats-paper-abstracts.ts
 *   DRY_RUN=0 pnpm --filter km exec tsx scripts/backfill-jats-paper-abstracts.ts
 *
 * DSN resolution: OWNER_DATABASE_URL ?? MIGRATE_DATABASE_URL ?? DATABASE_URL.
 * Owner role is required because we UPDATE the papers table.
 *
 * DO NOT RUN against prod without explicit go-ahead.
 */
import postgres from "postgres";
import { shouldRewriteAbstract } from "../src/lib/citations/jats-paper-backfill";

function resolveDsn(): string {
  const dsn =
    process.env.OWNER_DATABASE_URL ??
    process.env.MIGRATE_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!dsn) {
    throw new Error(
      "No DSN found. Set OWNER_DATABASE_URL, MIGRATE_DATABASE_URL, or DATABASE_URL.",
    );
  }
  return dsn;
}

function isDryRun(): boolean {
  const v = process.env.DRY_RUN;
  if (v == null) return true;
  const lower = v.toLowerCase();
  return !(lower === "0" || lower === "false" || lower === "");
}

async function main() {
  const dryRun = isDryRun();
  const sql = postgres(resolveDsn());

  try {
    const rows = await sql<{ id: string; abstract_short: string | null }[]>`
      SELECT id, abstract_short
      FROM papers
      WHERE abstract_short IS NOT NULL
    `;

    let changed = 0;
    let skipped = 0;

    for (const row of rows) {
      const { rewrite, clean } = shouldRewriteAbstract(row.abstract_short);
      if (!rewrite) {
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        await sql`UPDATE papers SET abstract_short = ${clean} WHERE id = ${row.id}`;
      }
      changed += 1;
    }

    console.log(
      JSON.stringify(
        {
          mode: dryRun ? "dry-run" : "apply",
          total: rows.length,
          changed,
          skipped,
        },
        null,
        2,
      ),
    );
    if (dryRun) {
      console.log("Dry-run. Re-run with DRY_RUN=0 to apply.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
