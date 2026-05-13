/**
 * db:record-applied <tag>
 *
 * Records an out-of-band applied migration in drizzle.__drizzle_migrations so
 * future `drizzle-kit migrate` runs treat it as already applied.
 *
 * Usage:
 *   DATABASE_URL=<url> pnpm --filter @episteme/db db:record-applied 0021_papers_chandra_status
 *
 * Idempotent: does nothing if a row with the same hash already exists.
 */

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const migrationsDir = join(repoRoot, "packages/db/drizzle");
const journalPath = join(migrationsDir, "meta/_journal.json");

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: pnpm db:record-applied <tag>  (e.g. 0021_papers_chandra_status)");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlPath = join(migrationsDir, `${tag}.sql`);
if (!existsSync(sqlPath)) {
  console.error(`Migration file not found: ${sqlPath}`);
  process.exit(1);
}

const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) {
  console.error(`Tag '${tag}' not found in _journal.json`);
  process.exit(1);
}

// Hash matches drizzle-orm readMigrationFiles: sha256(raw file text, hex)
const fileText = readFileSync(sqlPath).toString();
const hash = createHash("sha256").update(fileText).digest("hex");
const createdAt = entry.when;

const sql = postgres(databaseUrl, { max: 1 });

try {
  // Check if already recorded
  const existing = await sql<{ id: number }[]>`
    SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
  `;
  if (existing.length > 0) {
    console.log(`Already recorded: ${tag} (id=${existing[0].id}, hash=${hash})`);
    process.exit(0);
  }

  const inserted = await sql<{ id: number }[]>`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${createdAt})
    RETURNING id
  `;
  console.log(`Recorded: ${tag} → id=${inserted[0].id}, hash=${hash}, created_at=${createdAt}`);
} finally {
  await sql.end({ timeout: 5 });
}
