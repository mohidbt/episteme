import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
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
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = opts?.repoRoot ?? resolve(here, "../../..");
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
          not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_references' and column_name = 'document_id' and is_nullable = 'NO'
          ),
          'document_id must be absent (rebaselined) or nullable (legacy compat window)'
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
          'paper_highlights.run_id_is_text',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'paper_highlights' and column_name = 'run_id' and data_type = 'text'
          ),
          'run_id must be text; agent writes uuid strings (caught prod 22P02 on 2026-05-12)'
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
        union all
        select
          'paper_highlights.run_page_bbox_unique_index_exists',
          exists (
            select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'paper_highlights'
              and indexname = 'paper_highlights_run_page_bbox_uk'
          ),
          'Round G partial unique index on (run_id, page, bbox::text) is missing'
        union all
        select
          'user_highlights.layer_page_offsets_unique_index_exists',
          exists (
            select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'user_highlights'
              and indexname = 'user_highlights_layer_page_offsets_uk'
          ),
          'Round G partial unique index on (layer_id, page_number, start_offset, end_offset) is missing'
        union all
        select
          'document_segments.paper_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_segments' and column_name = 'paper_id'
          ),
          'column required for chandra parse INSERT path'
        union all
        select
          'document_segments.paper_id_not_null',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_segments' and column_name = 'paper_id' and is_nullable = 'NO'
          ),
          'paper_id must be NOT NULL per current document_segments schema'
        union all
        select
          'document_outlines.paper_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'document_outlines' and column_name = 'paper_id'
          ),
          'column required after 0024 inhale-merger re-key'
        union all
        select
          'processing_jobs.paper_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'paper_id'
          ),
          'column required after 0024 inhale-merger re-key'
        union all
        select
          'agent_conversations.paper_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'agent_conversations' and column_name = 'paper_id'
          ),
          'column required after 0024 inhale-merger re-key'
        union all
        select
          'ai_highlight_runs.paper_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'ai_highlight_runs' and column_name = 'paper_id'
          ),
          'column required after 0025 paper_id-keyed restore'
        union all
        select
          'papers.storage_url_present_for_parse_active_rows',
          not exists (
            select 1
            from papers p
            where p.chandra_status in ('running', 'done', 'failed')
              and p.storage_url is null
          ),
          'parse-active papers must have storage_url'
        union all
        select
          'papers.storage_url_canonical_shape',
          not exists (
            select 1
            from papers p
            where p.storage_url is not null
              and p.storage_url !~ '^[0-9a-fA-F-]{36}/source\\.pdf$'
          ),
          'storage_url must match <paper_uuid>/source.pdf'
        union all
        select
          'user_signup_profiles.user_id_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'user_id'
          ),
          'required for signup persona profile linkage'
        union all
        select
          'user_signup_profiles.student_level_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'student_level'
          ),
          'required for student persona detail persistence'
        union all
        select
          'user_signup_profiles.job_role_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'job_role'
          ),
          'required for researcher/industry persona detail persistence'
        union all
        select
          'user_signup_profiles.industry_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'industry'
          ),
          'required for industry persona detail persistence'
        union all
        select
          'user_signup_profiles.persona_other_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'persona_other'
          ),
          'required for other persona detail persistence'
        union all
        select
          'user_signup_profiles.created_at_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'created_at'
          ),
          'required for signup persona profile audit metadata'
        union all
        select
          'user_signup_profiles.updated_at_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'user_signup_profiles' and column_name = 'updated_at'
          ),
          'required for signup persona profile audit metadata'
        union all
        select
          'signup_waitlist.email_single_column_pk',
          exists (
            select 1
            from pg_constraint c
            join pg_class t on t.oid = c.conrelid
            join pg_namespace n on n.oid = t.relnamespace
            join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
            where n.nspname = 'public'
              and t.relname = 'signup_waitlist'
              and c.contype = 'p'
              and array_length(c.conkey, 1) = 1
              and a.attname = 'email'
          ),
          'signup_waitlist email must be the single-column primary key for upsert'
        union all
        select
          'signup_waitlist.firstname_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'firstname'
          ),
          'required for waitlist signup payload persistence'
        union all
        select
          'signup_waitlist.username_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'username'
          ),
          'required for waitlist signup payload persistence'
        union all
        select
          'signup_waitlist.user_type_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'user_type'
          ),
          'required for waitlist persona routing'
        union all
        select
          'signup_waitlist.pokemon_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'pokemon'
          ),
          'required for waitlist starter persistence'
        union all
        select
          'signup_waitlist.student_level_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'student_level'
          ),
          'required for waitlist student persona detail persistence'
        union all
        select
          'signup_waitlist.job_role_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'job_role'
          ),
          'required for waitlist researcher/industry persona detail persistence'
        union all
        select
          'signup_waitlist.industry_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'industry'
          ),
          'required for waitlist industry persona detail persistence'
        union all
        select
          'signup_waitlist.persona_other_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'persona_other'
          ),
          'required for waitlist other persona detail persistence'
        union all
        select
          'signup_waitlist.attempted_invite_code_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'attempted_invite_code'
          ),
          'required for waitlist invite attempt tracking'
        union all
        select
          'signup_waitlist.created_at_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'created_at'
          ),
          'required for waitlist audit metadata'
        union all
        select
          'signup_waitlist.updated_at_exists',
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'signup_waitlist' and column_name = 'updated_at'
          ),
          'required for waitlist audit metadata'
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
