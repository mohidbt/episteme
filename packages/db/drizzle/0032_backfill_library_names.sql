-- A2: Backfill library names from user.name first token.
--
-- Existing users seeded before P0's deriveLibraryName() helper landed kept
-- the legacy default labels ("My Library" / "Example Library"). This
-- migration rewrites only those default-named rows to "{firstname}'s Library"
-- where firstname is split_part(user.name, ' ', 1).
--
-- Fallback: when user.name is blank or NULL, COALESCE(NULLIF(...), 'My')
-- yields "My's Library" — same fallback as deriveLibraryName() ("My Library"
-- vs "My's Library" differ; this stays in default-name space so a future
-- backfill could touch it again if we ever want to refine).
--
-- Idempotent: re-running is a no-op because the IN-clause no longer matches
-- once names have been rewritten. Custom-named libraries are not touched.
--
-- Note: schema column is libraries.user_id (not owner_id). User table is
-- "user" (double-quoted, reserved word).
UPDATE libraries l
   SET name = COALESCE(NULLIF(split_part(u.name, ' ', 1), ''), 'My') || '''s Library'
  FROM "user" u
 WHERE l.user_id = u.id
   AND l.name IN ('My Library', 'Example Library');
