-- Enforce one library per user.
--
-- The schema previously allowed N libraries per user_id; in production this
-- happened (anon→user migration re-parented an anon library into a user that
-- already had one, plus retries of the seed hook). This migration:
--   1. Picks the OLDEST library per user as the survivor.
--   2. Resolves uniqueness collisions on child tables BEFORE re-parenting:
--        - references: drop duplicate (survivor_lib, citation_key) rows from
--          the dupe library; the survivor already has the citation.
--        - folders:    rename colliding (parent_id, name) rows in the dupe
--          library by appending " (merged from lib <dup_id>)" so the unique
--          index allows the re-parent.
--   3. Re-parents all child rows (folders, assets, notes, papers, papersets,
--      references) from duplicate libraries onto the survivor.
--   4. Deletes the duplicate library rows.
--   5. Adds a unique index on libraries.user_id.
--
-- Idempotent: re-running on a clean DB (no users with >1 library, index
-- already present) is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM libraries GROUP BY user_id HAVING count(*) > 1
  ) THEN
    -- Survivor map: oldest library per user_id.
    CREATE TEMP TABLE _lib_survivor ON COMMIT DROP AS
    SELECT DISTINCT ON (user_id)
           user_id,
           id AS survivor_id
      FROM libraries
     ORDER BY user_id, created_at ASC, id ASC;

    -- Remap of every duplicate library → its survivor (skips survivor itself).
    CREATE TEMP TABLE _lib_remap ON COMMIT DROP AS
    SELECT l.id AS dup_id,
           s.survivor_id
      FROM libraries l
      JOIN _lib_survivor s ON s.user_id = l.user_id
     WHERE l.id <> s.survivor_id;

    -- Resolve references collisions: delete dupe-lib rows whose citation_key
    -- already exists in the survivor lib. The survivor wins.
    DELETE FROM "references" r
     USING _lib_remap m
     WHERE r.library_id = m.dup_id
       AND EXISTS (
         SELECT 1 FROM "references" s
          WHERE s.library_id = m.survivor_id
            AND s.citation_key = r.citation_key
       );

    -- Resolve folder collisions: rename colliding (parent_id, name) rows in
    -- the dupe library so the unique index permits re-parenting. parent_id
    -- can be NULL; treat NULL as a distinct group via IS NOT DISTINCT FROM.
    UPDATE folders f
       SET name = f.name || ' (merged from lib ' || f.library_id || ')'
      FROM _lib_remap m
     WHERE f.library_id = m.dup_id
       AND EXISTS (
         SELECT 1 FROM folders s
          WHERE s.library_id = m.survivor_id
            AND s.name = f.name
            AND s.parent_id IS NOT DISTINCT FROM f.parent_id
       );

    -- Re-parent child rows.
    UPDATE folders   SET library_id = r.survivor_id FROM _lib_remap r WHERE folders.library_id   = r.dup_id;
    UPDATE assets    SET library_id = r.survivor_id FROM _lib_remap r WHERE assets.library_id    = r.dup_id;
    UPDATE notes     SET library_id = r.survivor_id FROM _lib_remap r WHERE notes.library_id     = r.dup_id;
    UPDATE papers    SET library_id = r.survivor_id FROM _lib_remap r WHERE papers.library_id    = r.dup_id;
    UPDATE papersets SET library_id = r.survivor_id FROM _lib_remap r WHERE papersets.library_id = r.dup_id;
    UPDATE "references" SET library_id = r.survivor_id FROM _lib_remap r WHERE "references".library_id = r.dup_id;

    -- Drop duplicate library rows.
    DELETE FROM libraries l USING _lib_remap r WHERE l.id = r.dup_id;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "libraries_user_id_unique"
  ON "libraries" USING btree ("user_id");
