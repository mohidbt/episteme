-- Split Neon roles for 2.3b B3.
--
-- Purpose: kill the manual psql write channel (root cause of 3 schema-drift
-- incidents in 14 days). Apps write through a role that cannot DDL; migrations
-- run through a separate role; humans get a read-only role for ad-hoc psql.
--
-- Run ONCE as neondb_owner via psql. Generate passwords out-of-band:
--   PW_APP=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
--   PW_MIG=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
--   PW_HUM=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
-- Substitute into the placeholders before piping to psql.
--
-- After run: update Vercel + GH secrets with the new conn strings, cut apps
-- over (see phase-2.3b-structural.md step 5), then revoke neondb_owner from
-- app use.
--
-- Roles created via raw SQL (NOT `neon roles create`) to avoid the implicit
-- `neon_superuser` group membership that bypasses table-level grants.

-- ============================================================================
-- app_runtime — used by apps/km, apps/reader, services/agents at runtime.
-- DML on public only. NO DDL. NO access to drizzle migration journal.
-- ============================================================================
CREATE ROLE app_runtime LOGIN PASSWORD '<APP_RUNTIME_PW>';
GRANT CONNECT ON DATABASE neondb TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;

-- ============================================================================
-- migrate_only — used by CI migrate workflow ONLY. Full DDL + drizzle journal.
-- ============================================================================
CREATE ROLE migrate_only LOGIN PASSWORD '<MIGRATE_ONLY_PW>';
GRANT CONNECT ON DATABASE neondb TO migrate_only;
GRANT ALL ON SCHEMA public TO migrate_only;
GRANT ALL ON SCHEMA drizzle TO migrate_only;
GRANT ALL ON ALL TABLES IN SCHEMA public TO migrate_only;
GRANT ALL ON ALL TABLES IN SCHEMA drizzle TO migrate_only;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO migrate_only;
GRANT ALL ON ALL SEQUENCES IN SCHEMA drizzle TO migrate_only;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO migrate_only;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO migrate_only;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT ALL ON TABLES TO migrate_only;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO migrate_only;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT ALL ON SEQUENCES TO migrate_only;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO migrate_only;

-- ============================================================================
-- humans_ro — for ad-hoc psql shells. Separate from predeploy_ro so we can
-- audit (different role name in pg_stat_activity).
-- ============================================================================
CREATE ROLE humans_ro LOGIN PASSWORD '<HUMANS_RO_PW>';
GRANT CONNECT ON DATABASE neondb TO humans_ro;
GRANT USAGE ON SCHEMA public TO humans_ro;
GRANT USAGE ON SCHEMA drizzle TO humans_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO humans_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO humans_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO humans_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO humans_ro;

-- ============================================================================
-- Verification queries (run after CREATE block above):
-- ============================================================================
-- As app_runtime:
--   SELECT count(*) FROM papers;                -- ok
--   INSERT INTO papers (...) VALUES (...);      -- ok (data-shape errors are fine)
--   CREATE TABLE x (y int);                     -- ERROR: permission denied for schema public
--   SELECT * FROM drizzle.__drizzle_migrations; -- ERROR: permission denied for schema drizzle
--
-- As humans_ro:
--   SELECT count(*) FROM papers;                -- ok
--   INSERT INTO papers (...) VALUES (...);      -- ERROR: permission denied
--   SELECT * FROM drizzle.__drizzle_migrations; -- ok
--
-- As migrate_only:
--   CREATE TABLE x (y int); DROP TABLE x;       -- ok
--   INSERT INTO drizzle.__drizzle_migrations    -- ok
