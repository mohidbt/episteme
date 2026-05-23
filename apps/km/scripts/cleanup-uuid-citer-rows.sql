-- One-shot data cleanup for paper_citations rows orphaned by the #57 schema
-- change (citer_kind='reference' / citer_id is a UUID, not a bigint id).
--
-- Pre-#57, paper_citations.citer_id stored bigint reference IDs as text;
-- post-#57 it switched to UUIDs (references.id). The legacy rows that still
-- look like UUIDs in a citer slot need to be removed — there is no rational
-- semantic that pairs a reference (UUID) as the citer.
--
-- This is NOT a schema migration. It is a one-shot DELETE meant to be run
-- once against each environment that pre-dates #57. Safe to re-run (idempotent
-- once empty).
--
-- Run as: psql "$DATABASE_URL" -f apps/km/scripts/cleanup-uuid-citer-rows.sql
-- Role:   owner-real (paper_citations is owned by neondb_owner).

DELETE FROM paper_citations
 WHERE citer_kind = 'reference'
   AND citer_id !~ '^[0-9]+$';
