import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { basename, join, resolve } from "path";
import postgres from "postgres";

const MIGRATION_FILE_RE = /^(\d{4}_.+)\.sql$/;

export type CheckResult = {
  name: string;
  ok: boolean;
  details?: string;
};

export type JournalCheckSummary = {
  ok: boolean;
  latestTag: string;
  checks: CheckResult[];
  journalTags: string[];
  migrationFileTags: string[];
};

export type DbCheckSummary = {
  ok: boolean;
  fingerprint: string;
  latestAppliedMigration: { id: number; hash: string; createdAt: string } | null;
  checks: CheckResult[];
};

type CriticalCheckRow = {
  check_name: string;
  ok: boolean;
  details: string;
};

export function mapCriticalCheckRows(rows: CriticalCheckRow[]): CheckResult[] {
  return rows.map((row) => ({
    name: row.check_name,
    ok: row.ok,
    details: row.ok ? undefined : row.details,
  }));
}

export type PredeployCheckSummary = {
  ok: boolean;
  timestamp: string;
  journal: JournalCheckSummary;
  db: DbCheckSummary;
};

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function stableString(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v === null ? "<null>" : v));
}

export function runJournalChecks(opts?: {
  repoRoot?: string;
  migrationsDir?: string;
  journalPath?: string;
}): JournalCheckSummary {
  const repoRoot = opts?.repoRoot ?? resolve(__dirname, "../../..");
  const migrationsDir = opts?.migrationsDir ?? join(repoRoot, "packages/db/drizzle");
  const journalPath = opts?.journalPath ?? join(repoRoot, "packages/db/drizzle/meta/_journal.json");

  const migrationFileTags = readdirSync(migrationsDir)
    .map((name) => {
      const match = name.match(MIGRATION_FILE_RE);
      return match ? match[1] : null;
    })
    .filter((tag): tag is string => tag !== null)
    .sort();

  const journalRaw = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const journalTags = journalRaw.entries.map((entry) => entry.tag);

  const checks: CheckResult[] = [];

  const contiguousIdx = journalRaw.entries.every((entry, index) => entry.idx === index);
  checks.push({
    name: "journal_idx_contiguous",
    ok: contiguousIdx,
    details: contiguousIdx ? undefined : "journal idx sequence is not contiguous from 0",
  });

  const journalMatchesFiles =
    journalTags.length === migrationFileTags.length &&
    journalTags.every((tag, index) => tag === migrationFileTags[index]);
  checks.push({
    name: "journal_matches_migration_files",
    ok: journalMatchesFiles,
    details: journalMatchesFiles
      ? undefined
      : `journal tags and migration files differ (journal=${journalTags.length}, files=${migrationFileTags.length})`,
  });

  const latestTag = migrationFileTags[migrationFileTags.length - 1] ?? "<none>";

  return {
    ok: checks.every((check) => check.ok),
    latestTag,
    checks,
    journalTags,
    migrationFileTags,
  };
}

export async function runDbChecks(databaseUrl: string): Promise<DbCheckSummary> {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const checks: CheckResult[] = [];

    const identityRows = await sql<{
      db_name: string | null;
      db_user: string | null;
      host_addr: string | null;
      host_port: number | null;
    }[]>`
      select
        current_database() as db_name,
        current_user as db_user,
        inet_server_addr()::text as host_addr,
        inet_server_port() as host_port
    `;
    const identity = identityRows[0] ?? {
      db_name: null,
      db_user: null,
      host_addr: null,
      host_port: null,
    };

    const migrationRows = await sql<{
      id: number;
      hash: string;
      created_at: string;
    }[]>`
      select id, hash, created_at::text
      from drizzle.__drizzle_migrations
      order by id asc
    `;

    const latestAppliedMigration =
      migrationRows.length > 0
        ? {
            id: migrationRows[migrationRows.length - 1].id,
            hash: migrationRows[migrationRows.length - 1].hash,
            createdAt: migrationRows[migrationRows.length - 1].created_at,
          }
        : null;

    const contiguousMigrationIds = migrationRows.every((row, i) => row.id === i + 1);
    checks.push({
      name: "drizzle_migration_ids_contiguous",
      ok: contiguousMigrationIds,
      details: contiguousMigrationIds ? undefined : "drizzle.__drizzle_migrations ids are not contiguous from 1",
    });

    const criticalRows = await sql<CriticalCheckRow[]>`
      with checks as (
        select
          'document_references.paper_id_exists'::text as check_name,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_references' and column_name = 'paper_id'
          ) as ok,
          'column required by citation extraction hot path'::text as details
        union all
        select
          'document_references.paper_id_not_null',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_references' and column_name = 'paper_id' and is_nullable = 'NO'
          ),
          'paper_id must be NOT NULL per current schema'
        union all
        select
          'document_references.document_id_nullable',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_references' and column_name = 'document_id' and is_nullable = 'YES'
          ),
          'compatibility window requires document_id nullable until backfill cleanup migration'
        union all
        select
          'paper_highlights.run_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'paper_highlights' and column_name = 'run_id'
          ),
          'required for highlight run linkage'
        union all
        select
          'paper_highlights.tool_call_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'paper_highlights' and column_name = 'tool_call_id'
          ),
          'required for reader tool traceability'
        union all
        select
          'user_highlights.paper_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_highlights' and column_name = 'paper_id'
          ),
          'required for user highlights paper linkage'
        union all
        select
          'user_highlights.paper_id_not_null',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_highlights' and column_name = 'paper_id' and is_nullable = 'NO'
          ),
          'paper_id must be NOT NULL per current user_highlights schema'
        union all
        select
          'user_highlights.user_paper_index_exists',
          exists (
            select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'user_highlights'
              and indexname = 'user_highlights_user_paper_idx'
          ),
          'expected user+paper access index is missing'
      )
      select check_name, ok, details from checks
    `;

    checks.push(...mapCriticalCheckRows(criticalRows));

    return {
      ok: checks.every((check) => check.ok),
      fingerprint: hashText(stableString(identity)),
      latestAppliedMigration,
      checks,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runPredeployChecks(databaseUrl: string, opts?: {
  repoRoot?: string;
  migrationsDir?: string;
  journalPath?: string;
}): Promise<PredeployCheckSummary> {
  const journal = runJournalChecks(opts);
  const db = await runDbChecks(databaseUrl);

  return {
    ok: journal.ok && db.ok,
    timestamp: new Date().toISOString(),
    journal,
    db,
  };
}

export function formatPredeployFailure(summary: PredeployCheckSummary): string {
  const failed = [
    ...summary.journal.checks.filter((check) => !check.ok).map((check) => `journal:${check.name}`),
    ...summary.db.checks.filter((check) => !check.ok).map((check) => `db:${check.name}`),
  ];

  return failed.length > 0
    ? `Schema predeploy check failed: ${failed.join(", ")}`
    : "Schema predeploy check failed";
}

export function drizzleTagFromFile(fileName: string): string | null {
  const match = basename(fileName).match(MIGRATION_FILE_RE);
  return match ? match[1] : null;
}
