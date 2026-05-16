-- Backfill DOIs on existing guest-seeded PSM papers.
--
-- Three seed papers ship with doi=null today; users running on these
-- demo workspaces miss out on Semantic Scholar enrichment. Match by
-- title prefix (titles are unique enough in this corpus) and stamp the
-- looked-up DOI.
--
-- Race-safe: `WHERE doi IS NULL` guard means re-running is a no-op for
-- already-stamped rows. Real users who happened to set their own DOI on
-- a same-titled paper are unaffected.
--
-- Future seeds carry the DOI directly (see seed-anonymous-user.ts);
-- this migration covers the pre-existing population.
--
-- papers is owned by neondb_owner → apply via apply-migrations.yml
-- role=owner-real.

UPDATE papers
SET doi = '10.22454/FamMed.2025.305728'
WHERE doi IS NULL
  AND title LIKE 'Using Propensity-Score Matched Cohorts to Evaluate Career Outcomes%';
--> statement-breakpoint

UPDATE papers
SET doi = '10.1101/2025.07.31.25332504'
WHERE doi IS NULL
  AND title LIKE 'Propensity-score matching with GAN-generated observations%';
--> statement-breakpoint

UPDATE papers
SET doi = '10.1016/j.cstp.2025.101592'
WHERE doi IS NULL
  AND title LIKE 'Propensity score matching%difference-in-differences analysis of the casual effect of opening intermediate high-speed railway stations%';
