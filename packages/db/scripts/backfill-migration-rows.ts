import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

// Companion to scripts/repair-prod-22-30.sql. Inserts journal rows for
// migrations 0022..0030 into drizzle.__drizzle_migrations using the same
// SHA256-of-file-content algorithm drizzle's readMigrationFiles uses
// (drizzle-orm@0.45.2 migrator.js:23) so the next pnpm db:migrate is
// guaranteed a no-op.
//
// We read meta/_journal.json directly because drizzle's readMigrationFiles
// strips the `tag` field from its return value — we need tag + when to
// identify which entries to insert.
//
// Order: repair SQL first (schema), then this (journal).

const REPAIR_FROM_IDX = 22;

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = { version: string; dialect: string; entries: JournalEntry[] };

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const journal = JSON.parse(
    readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"),
  ) as Journal;

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const identity = await sql<{ db_name: string; host: string | null }[]>`
      select current_database() as db_name, host(inet_server_addr()) as host
    `;
    console.log(`connected to db=${identity[0].db_name} host=${identity[0].host ?? "local"}`);

    const existing = await sql<{ hash: string }[]>`
      select hash from drizzle.__drizzle_migrations
    `;
    const have = new Set(existing.map((row) => row.hash));

    for (const entry of journal.entries) {
      if (entry.idx < REPAIR_FROM_IDX) continue;

      const sqlPath = `${migrationsFolder}/${entry.tag}.sql`;
      const content = readFileSync(sqlPath, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");

      if (have.has(hash)) {
        console.log(`skip ${entry.tag} — hash already present`);
        continue;
      }

      await sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${hash}, ${entry.when})
      `;
      console.log(`inserted ${entry.tag} hash=${hash.slice(0, 12)}… when=${entry.when}`);
    }

    const finalCount = await sql<{ count: number; max_id: number }[]>`
      select count(*)::int as count, coalesce(max(id), 0)::int as max_id
        from drizzle.__drizzle_migrations
    `;
    console.log(
      `done: ${finalCount[0].count} rows, max id=${finalCount[0].max_id}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
