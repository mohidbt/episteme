/**
 * GSD-32 Phase 4 backfill: ensure every legacy paper has a hidden ref-twin.
 *
 * Idempotent. Skips papers that already have a `references_` row with
 * paper_id set, or whose DOI matches an existing library reference (in which
 * case it binds that ref's paper_id and skips insert).
 *
 * Usage:
 *   pnpm --filter @episteme/db exec tsx scripts/backfill-paper-refs.ts
 *
 * Env:
 *   OWNER_DATABASE_URL or MIGRATE_DATABASE_URL — Postgres DSN with INSERT on
 *   `references` + UPDATE on `references.paper_id` + SELECT on `papers`.
 *
 * SAFETY: writes to DB. Dry-run via DRY_RUN=1 prints candidate count + sample.
 */

import postgres from "postgres";

interface PaperRow {
  id: string;
  library_id: number;
  user_id: string;
  title: string | null;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "on", "of", "in", "to", "for",
  "and", "or", "with", "from", "at", "by", "is",
]);

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function deriveCitationKey(title: string | null, authors: string[] | null, year: number | null): string {
  const firstAuthor = authors?.[0] ?? "unknown";
  const authorPart = normalise(firstAuthor) || "unknown";
  const yearPart = typeof year === "number" && isFinite(year) ? String(year) : "nd";
  let titlePart = "untitled";
  if (title) {
    const words = title.split(/\s+/);
    const substantial = words.find((w) => !STOP_WORDS.has(w.toLowerCase()));
    if (substantial) titlePart = normalise(substantial) || "untitled";
  }
  return authorPart + yearPart + titlePart;
}

function buildCsl(p: PaperRow): Record<string, unknown> {
  const csl: Record<string, unknown> = {
    id: p.id,
    type: "article-journal",
    title: p.title ?? `Paper ${p.id.slice(0, 8)}`,
  };
  if (p.authors && p.authors.length > 0) {
    csl.author = p.authors.map((a) => ({ literal: a }));
  }
  if (p.year != null) csl.issued = { "date-parts": [[p.year]] };
  if (p.doi) csl.DOI = p.doi;
  return csl;
}

async function main() {
  const dsn = process.env.OWNER_DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dsn) {
    console.error("OWNER_DATABASE_URL / MIGRATE_DATABASE_URL / DATABASE_URL required");
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === "1";
  const sql = postgres(dsn, { max: 1, prepare: false });

  try {
    const papers = (await sql<PaperRow[]>`
      SELECT id, library_id, user_id, title, authors, year, doi
      FROM papers
    `) as unknown as PaperRow[];

    console.log(`backfill: ${papers.length} papers to inspect (dryRun=${dryRun})`);
    let created = 0;
    let boundExistingByDoi = 0;
    let skippedExisting = 0;

    for (const p of papers) {
      const existing = await sql`
        SELECT id FROM "references"
        WHERE user_id = ${p.user_id} AND paper_id = ${p.id}
        LIMIT 1
      `;
      if ((existing as unknown as { id: string }[]).length > 0) {
        skippedExisting++;
        continue;
      }
      if (p.doi) {
        const doiHit = await sql`
          SELECT id, paper_id FROM "references"
          WHERE user_id = ${p.user_id}
            AND library_id = ${p.library_id}
            AND lower(csl_json->>'DOI') = lower(${p.doi})
          LIMIT 1
        ` as unknown as { id: string; paper_id: string | null }[];
        if (doiHit.length > 0) {
          if (doiHit[0].paper_id == null) {
            if (!dryRun) {
              await sql`UPDATE "references" SET paper_id = ${p.id} WHERE id = ${doiHit[0].id}`;
            }
            boundExistingByDoi++;
          } else {
            skippedExisting++;
          }
          continue;
        }
      }
      const csl = buildCsl(p);
      const citationKey = deriveCitationKey(p.title, p.authors, p.year);
      if (!dryRun) {
        try {
          await sql`
            INSERT INTO "references" (library_id, user_id, folder_path, citation_key, csl_json, paper_id)
            VALUES (${p.library_id}, ${p.user_id}, '', ${citationKey}, ${sql.json(csl)}, ${p.id})
          `;
          created++;
        } catch (err) {
          // citation_key collision is the only expected failure — skip without aborting.
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("references_library_key_unique")) {
            console.warn(`backfill: skip paper ${p.id} — citation key conflict (${citationKey})`);
            skippedExisting++;
          } else {
            throw err;
          }
        }
      } else {
        created++;
      }
    }
    console.log(`backfill: created=${created} boundExistingByDoi=${boundExistingByDoi} skippedExisting=${skippedExisting}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
