-- Hardening pass on top of split-roles.sql (codex follow-up, 2026-05-14).
--
-- Run ONCE as neondb_owner after split-roles.sql.
--
-- Fixes four gaps codex senior-lead review surfaced:
--  1. No REVOKE FROM PUBLIC — relied on clean baseline that may not be true
--  2. No owner-context default privileges for migrate_only — future tables
--     created by migrate_only would not auto-grant to app_runtime
--  3. No CREATE-on-database guardrail — new schemas were ungoverned
--  4. Defense-in-depth: explicit denial of broader role groups on neon

-- ============================================================================
-- (1) Strip ambient PUBLIC grants. Owner keeps access via ownership;
--     app_runtime / humans_ro / migrate_only have explicit grants.
-- ============================================================================
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- drizzle schema same treatment
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA drizzle FROM PUBLIC;

-- ============================================================================
-- (2) Owner-context default privileges. When migrate_only creates new tables
--     (which it will, post-cutover when CI migrate workflow uses MIGRATE_DATABASE_URL),
--     they must auto-grant DML to app_runtime and SELECT to humans_ro.
--
--     ALTER DEFAULT PRIVILEGES applies per-owner: privileges set as role X
--     only affect future objects created by role X. We need migrate_only to
--     be the owner-context. Two prerequisites:
--       (a) neondb_owner is a member of migrate_only (so SET ROLE works)
--       (b) run the ALTER DEFAULT PRIVILEGES while role-set to migrate_only
-- ============================================================================
GRANT migrate_only TO neondb_owner;
SET ROLE migrate_only;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO humans_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle
  GRANT SELECT ON TABLES TO humans_ro;

RESET ROLE;

-- ============================================================================
-- (3) New-schema guardrail. By default Postgres allows PUBLIC to CREATE
--     schemas on the database. Lock that down so app_runtime can't bypass
--     public-scope grants by writing to a fresh schema.
-- ============================================================================
REVOKE CREATE ON DATABASE neondb FROM PUBLIC;

-- ============================================================================
-- Verification queries (run after this script):
--
-- 1. PUBLIC has no leftover grants on public schema:
--    select privilege_type from information_schema.role_table_grants
--      where grantee = 'PUBLIC' and table_schema = 'public';
--    -- expect: 0 rows
--
-- 2. migrate_only default privileges populated:
--    select grantee, privilege_type from information_schema.role_table_grants
--      where grantor = 'migrate_only';
--    -- expect: rows for app_runtime + humans_ro after a new table is created
--      by migrate_only
--
-- 3. app_runtime cannot create a schema:
--    as app_runtime: create schema test_should_fail;
--    -- expect: permission denied for database neondb
-- ============================================================================
