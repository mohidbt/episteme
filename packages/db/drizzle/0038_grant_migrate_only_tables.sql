-- Permission fix for migrate_only-owned tables.
--
-- 0036 created paper_citations + invite_codes; 0034 created openrouter_usage.
-- migrate_only owns these. predeploy_ro / humans_ro / app_runtime got nothing
-- because the existing ALTER DEFAULT PRIVILEGES (packages/db/ops/split-roles.sql,
-- predeploy-ro.sql) was issued WITHOUT `FOR ROLE migrate_only` — Postgres scopes
-- defaults to the issuer, so migrate_only's future tables bypass them.
--
-- Symptom: schema-snapshot-diff workflow (#6) failed with
--   pg_dump: ERROR: permission denied for table paper_citations
-- as predeploy_ro could not LOCK TABLE in ACCESS SHARE.
--
-- This migration:
--   1. One-shot grants on the three migrate_only-owned tables for the three
--      read consumers.
--   2. Sets ALTER DEFAULT PRIVILEGES FOR ROLE migrate_only so future
--      migrate_only-created tables auto-grant.
--
-- BG9: Wrapped in role-existence guards so the migration is idempotent across
-- envs. Prod has all four roles (predeploy_ro / humans_ro / app_runtime /
-- migrate_only); the predeploy ephemeral postgres container in
-- schema-predeploy-gate.yml has none of them. Without the guards, replaying
-- migrations 0000→latest against the ephemeral DB fails here.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'predeploy_ro') THEN
    EXECUTE 'GRANT SELECT ON paper_citations, invite_codes, openrouter_usage TO predeploy_ro';
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'humans_ro') THEN
    EXECUTE 'GRANT SELECT ON paper_citations, invite_codes, openrouter_usage TO humans_ro';
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON paper_citations, invite_codes, openrouter_usage TO app_runtime';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime';
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrate_only')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'predeploy_ro') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE migrate_only IN SCHEMA public GRANT SELECT ON TABLES TO predeploy_ro';
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrate_only')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'humans_ro') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE migrate_only IN SCHEMA public GRANT SELECT ON TABLES TO humans_ro';
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrate_only')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE migrate_only IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE migrate_only IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime';
  END IF;
END $$;
