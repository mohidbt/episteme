-- Run this ONCE on an existing dev database where tables were created via
-- drizzle-kit push (not migrate). It marks the rebaselined 0000 migration
-- as already applied so that `npm run db:migrate` becomes a no-op.
--
-- Usage:
--   psql -U inhale -d inhale -f scripts/mark-migrations-applied.sql

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '3e642a40d44e5bf4ce36feac6c1d958da7208c0c69143bc8997ffc86eed07736', 1775983138885
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations
  WHERE hash = '3e642a40d44e5bf4ce36feac6c1d958da7208c0c69143bc8997ffc86eed07736'
);
