-- Reconciliation migration for mixed legacy/new citation schemas.
-- Goal: keep citation extraction writes working while environments migrate
-- from document_id-based references to paper_id-based references.

ALTER TABLE "document_references"
  ADD COLUMN IF NOT EXISTS "paper_id" uuid;

-- Legacy environments may still require document_id NOT NULL, but current
-- app writes are keyed by paper_id. Relax nullability for compatibility.
ALTER TABLE "document_references"
  ALTER COLUMN "document_id" DROP NOT NULL;

-- Best-effort backfill for rows that still have only document_id.
-- Uses (user_id, filename) as the shared stable bridge between legacy
-- documents rows and papers rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'documents'
       AND column_name IN ('id', 'user_id', 'filename')
     GROUP BY table_name
    HAVING count(*) = 3
  ) AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'papers'
       AND column_name IN ('id', 'user_id', 'filename')
     GROUP BY table_name
    HAVING count(*) = 3
  ) THEN
    WITH candidate_map AS (
      SELECT
        d.id AS document_id,
        p.id AS paper_id,
        row_number() OVER (
          PARTITION BY d.id
          ORDER BY p.updated_at DESC NULLS LAST, p.added_at DESC NULLS LAST
        ) AS rn
      FROM documents d
      JOIN papers p
        ON p.user_id = d.user_id
       AND p.filename = d.filename
    )
    UPDATE document_references dr
       SET paper_id = cm.paper_id
      FROM candidate_map cm
     WHERE dr.document_id = cm.document_id
       AND cm.rn = 1
       AND dr.paper_id IS NULL;
  END IF;
END $$;

-- Add FK when absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'document_references_paper_id_papers_id_fk'
       AND conrelid = 'document_references'::regclass
  ) THEN
    ALTER TABLE "document_references"
      ADD CONSTRAINT "document_references_paper_id_papers_id_fk"
      FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "document_references_paper_id_idx"
  ON "document_references" USING btree ("paper_id");
