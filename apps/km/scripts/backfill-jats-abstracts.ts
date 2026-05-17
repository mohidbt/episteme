/**
 * BG4 backfill — strip JATS XML out of `references.csl_json->>'abstract'`.
 *
 * One-shot remediation for rows written before crossRefToCsl() began calling
 * stripJats(). Reads every references_ row whose abstract still contains a
 * `<jats:` substring, rewrites the abstract in-place, and updates the row.
 *
 * Usage (dry-run by default):
 *   pnpm --filter km exec tsx scripts/backfill-jats-abstracts.ts
 *   pnpm --filter km exec tsx scripts/backfill-jats-abstracts.ts --apply
 *
 * DO NOT RUN without explicit go-ahead — flagged in plan #41 follow-up.
 */
import { db } from "@episteme/db";
import { references_ } from "@episteme/db/schema/references";
import { eq, sql } from "drizzle-orm";
import { stripJats } from "../src/lib/crossref";

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db
    .select({ id: references_.id, cslJson: references_.cslJson })
    .from(references_)
    .where(sql`(${references_.cslJson} ->> 'abstract') LIKE '%<jats:%'`);

  console.log(`Found ${rows.length} references with JATS in abstract`);

  let updated = 0;
  for (const row of rows) {
    const csl = row.cslJson as Record<string, unknown> | null;
    if (!csl || typeof csl.abstract !== "string") continue;
    const cleaned = stripJats(csl.abstract);
    if (cleaned === csl.abstract) continue;

    if (apply) {
      await db
        .update(references_)
        .set({ cslJson: { ...csl, abstract: cleaned } })
        .where(eq(references_.id, row.id));
    }
    updated += 1;
  }

  console.log(
    apply
      ? `Updated ${updated} rows`
      : `Would update ${updated} rows (re-run with --apply)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
