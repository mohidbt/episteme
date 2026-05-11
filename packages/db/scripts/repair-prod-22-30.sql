-- Repair script: bring prod schema from partial 0024 state to 0030.
--
-- Background: prod's drizzle.__drizzle_migrations max id is 21, but a mix of
-- 0022..0029 was applied manually over time. This script finishes the work
-- of 0024 on the four tables still keyed by document_id and applies 0025,
-- 0026, 0028, 0030 (0027 and 0029 are already in place).
--
-- This script is idempotent. The companion script
-- scripts/backfill-migration-rows.ts inserts the matching journal rows so
-- drizzle's next migrate() is a true no-op. Run order: this SQL first,
-- then the TS backfill.
--
-- Single transaction: either every change applies or none do.

BEGIN;

-- ---------------------------------------------------------------------------
-- Pre-flight identity check. Forces visible confirmation of the target DB.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'repair connected to db=% host=% port=% user=%',
    current_database(),
    coalesce(host(inet_server_addr()), 'local'),
    inet_server_port(),
    current_user;
END $$;

-- ---------------------------------------------------------------------------
-- Section 1: finish 0024 on the four tables still keyed by document_id.
-- All four tables are verified empty on prod, so SET NOT NULL is safe with
-- no backfill. NOT inlining 0024's `documents`-probe — those rows are gone
-- and the table is about to be dropped in section 2.
-- ---------------------------------------------------------------------------

-- 1a. document_outlines
ALTER TABLE document_outlines ADD COLUMN IF NOT EXISTS paper_id uuid;
ALTER TABLE document_outlines ALTER COLUMN paper_id SET NOT NULL;
ALTER TABLE document_outlines DROP CONSTRAINT IF EXISTS document_outlines_document_id_documents_id_fk;
ALTER TABLE document_outlines DROP CONSTRAINT IF EXISTS document_outlines_document_id_unique;
ALTER TABLE document_outlines DROP COLUMN IF EXISTS document_id;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_outlines_paper_id_unique'
       AND conrelid = 'document_outlines'::regclass
  ) THEN
    ALTER TABLE document_outlines
      ADD CONSTRAINT document_outlines_paper_id_unique UNIQUE (paper_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_outlines_paper_id_papers_id_fk'
       AND conrelid = 'document_outlines'::regclass
  ) THEN
    ALTER TABLE document_outlines
      ADD CONSTRAINT document_outlines_paper_id_papers_id_fk
      FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 1b. document_segments
ALTER TABLE document_segments ADD COLUMN IF NOT EXISTS paper_id uuid;
ALTER TABLE document_segments ALTER COLUMN paper_id SET NOT NULL;
DROP INDEX IF EXISTS document_segments_document_page_idx;
ALTER TABLE document_segments DROP COLUMN IF EXISTS document_id;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_segments_paper_id_papers_id_fk'
       AND conrelid = 'document_segments'::regclass
  ) THEN
    ALTER TABLE document_segments
      ADD CONSTRAINT document_segments_paper_id_papers_id_fk
      FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS document_segments_paper_page_idx
  ON document_segments USING btree (paper_id, page);

-- 1c. processing_jobs
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS paper_id uuid;
ALTER TABLE processing_jobs ALTER COLUMN paper_id SET NOT NULL;
ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_document_id_documents_id_fk;
ALTER TABLE processing_jobs DROP COLUMN IF EXISTS document_id;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'processing_jobs_paper_id_papers_id_fk'
       AND conrelid = 'processing_jobs'::regclass
  ) THEN
    ALTER TABLE processing_jobs
      ADD CONSTRAINT processing_jobs_paper_id_papers_id_fk
      FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 1d. agent_conversations
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS paper_id uuid;
ALTER TABLE agent_conversations ALTER COLUMN paper_id SET NOT NULL;
ALTER TABLE agent_conversations DROP CONSTRAINT IF EXISTS agent_conversations_document_id_documents_id_fk;
DROP INDEX IF EXISTS agent_conversations_kind_idx;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS document_id;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent_conversations_paper_id_papers_id_fk'
       AND conrelid = 'agent_conversations'::regclass
  ) THEN
    ALTER TABLE agent_conversations
      ADD CONSTRAINT agent_conversations_paper_id_papers_id_fk
      FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS agent_conversations_kind_idx
  ON agent_conversations USING btree (paper_id, kind);

-- ---------------------------------------------------------------------------
-- Section 2a: finish 0024 step 3 cleanup on document_references.
-- Prod was left with the document_id column + FK still present (only the
-- paper_id ADD half of step 3 had been applied). 0029 added paper_id NOT NULL
-- via its own path but didn't drop the legacy FK/column, so DROP TABLE
-- documents below would fail with a foreign-key dependency error.
-- ---------------------------------------------------------------------------
ALTER TABLE document_references
  DROP CONSTRAINT IF EXISTS document_references_document_id_documents_id_fk;
DROP INDEX IF EXISTS document_references_document_id_idx;
ALTER TABLE document_references DROP COLUMN IF EXISTS document_id;

-- ---------------------------------------------------------------------------
-- Section 2b: drop legacy objects (now unreferenced).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS ai_highlight_runs;
DROP TABLE IF EXISTS documents;
DROP TYPE IF EXISTS processing_status;

-- ---------------------------------------------------------------------------
-- Section 3: apply 0025 — restore ai_highlight_runs in paper_id-keyed shape.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_highlight_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  paper_id uuid NOT NULL,
  user_id text NOT NULL,
  instruction text NOT NULL,
  model_used text,
  status text NOT NULL,
  summary text,
  conversation_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ai_highlight_runs_paper_id_papers_id_fk'
       AND conrelid = 'ai_highlight_runs'::regclass
  ) THEN
    ALTER TABLE ai_highlight_runs
      ADD CONSTRAINT ai_highlight_runs_paper_id_papers_id_fk
      FOREIGN KEY (paper_id) REFERENCES public.papers(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ai_highlight_runs_user_id_user_id_fk'
       AND conrelid = 'ai_highlight_runs'::regclass
  ) THEN
    ALTER TABLE ai_highlight_runs
      ADD CONSTRAINT ai_highlight_runs_user_id_user_id_fk
      FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ai_highlight_runs_conversation_id_agent_conversations_id_fk'
       AND conrelid = 'ai_highlight_runs'::regclass
  ) THEN
    ALTER TABLE ai_highlight_runs
      ADD CONSTRAINT ai_highlight_runs_conversation_id_agent_conversations_id_fk
      FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ai_highlight_runs_paper_idx
  ON ai_highlight_runs USING btree (paper_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Section 4: apply 0026 — library_references.folder_id.
-- ---------------------------------------------------------------------------
ALTER TABLE library_references ADD COLUMN IF NOT EXISTS folder_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'library_references_folder_id_folders_id_fk'
       AND conrelid = 'library_references'::regclass
  ) THEN
    ALTER TABLE library_references
      ADD CONSTRAINT library_references_folder_id_folders_id_fk
      FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS library_references_folder_idx
  ON library_references USING btree (user_id, folder_id);

-- ---------------------------------------------------------------------------
-- Section 5: apply 0028 — kg_schema tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semantic_edges (
  user_id text NOT NULL,
  src_kind text NOT NULL,
  src_id uuid NOT NULL,
  dst_kind text NOT NULL,
  dst_id uuid NOT NULL,
  weight real NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT semantic_edges_user_id_src_kind_src_id_dst_kind_dst_id_pk
    PRIMARY KEY (user_id, src_kind, src_id, dst_kind, dst_id)
);

CREATE TABLE IF NOT EXISTS reference_embeddings (
  reference_id uuid PRIMARY KEY NOT NULL,
  embedding vector(1536) NOT NULL,
  computed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_recompute (
  user_id text NOT NULL,
  kind text NOT NULL,
  node_id uuid NOT NULL,
  enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
  claimed_at timestamp with time zone,
  tries integer DEFAULT 0 NOT NULL,
  CONSTRAINT pending_recompute_user_id_kind_node_id_pk
    PRIMARY KEY (user_id, kind, node_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reference_embeddings_reference_id_references_id_fk'
       AND conrelid = 'reference_embeddings'::regclass
  ) THEN
    ALTER TABLE reference_embeddings
      ADD CONSTRAINT reference_embeddings_reference_id_references_id_fk
      FOREIGN KEY (reference_id) REFERENCES public."references"(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'semantic_edges_src_kind_chk'
       AND conrelid = 'semantic_edges'::regclass
  ) THEN
    ALTER TABLE semantic_edges
      ADD CONSTRAINT semantic_edges_src_kind_chk
      CHECK (src_kind IN ('paper', 'note'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'semantic_edges_dst_kind_chk'
       AND conrelid = 'semantic_edges'::regclass
  ) THEN
    ALTER TABLE semantic_edges
      ADD CONSTRAINT semantic_edges_dst_kind_chk
      CHECK (dst_kind IN ('paper', 'note', 'reference'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pending_recompute_kind_chk'
       AND conrelid = 'pending_recompute'::regclass
  ) THEN
    ALTER TABLE pending_recompute
      ADD CONSTRAINT pending_recompute_kind_chk
      CHECK (kind IN ('paper', 'note'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS semantic_edges_src
  ON semantic_edges USING btree (user_id, src_kind, src_id);
CREATE INDEX IF NOT EXISTS semantic_edges_dst
  ON semantic_edges USING btree (user_id, dst_kind, dst_id);
CREATE INDEX IF NOT EXISTS reference_embeddings_emb_idx
  ON reference_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS pending_recompute_enqueued
  ON pending_recompute USING btree (enqueued_at);
CREATE INDEX IF NOT EXISTS pending_recompute_claimed
  ON pending_recompute USING btree (claimed_at);

-- ---------------------------------------------------------------------------
-- Section 6: apply 0030 — one library per user. Verbatim copy from the repo
-- file; already self-idempotent (DO block + IF NOT EXISTS on index).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM libraries GROUP BY user_id HAVING count(*) > 1
  ) THEN
    CREATE TEMP TABLE _lib_survivor ON COMMIT DROP AS
    SELECT DISTINCT ON (user_id)
           user_id,
           id AS survivor_id
      FROM libraries
     ORDER BY user_id, created_at ASC, id ASC;

    CREATE TEMP TABLE _lib_remap ON COMMIT DROP AS
    SELECT l.id AS dup_id,
           s.survivor_id
      FROM libraries l
      JOIN _lib_survivor s ON s.user_id = l.user_id
     WHERE l.id <> s.survivor_id;

    DELETE FROM "references" r
     USING _lib_remap m
     WHERE r.library_id = m.dup_id
       AND EXISTS (
         SELECT 1 FROM "references" s
          WHERE s.library_id = m.survivor_id
            AND s.citation_key = r.citation_key
       );

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

    UPDATE folders   SET library_id = r.survivor_id FROM _lib_remap r WHERE folders.library_id   = r.dup_id;
    UPDATE assets    SET library_id = r.survivor_id FROM _lib_remap r WHERE assets.library_id    = r.dup_id;
    UPDATE notes     SET library_id = r.survivor_id FROM _lib_remap r WHERE notes.library_id     = r.dup_id;
    UPDATE papers    SET library_id = r.survivor_id FROM _lib_remap r WHERE papers.library_id    = r.dup_id;
    UPDATE papersets SET library_id = r.survivor_id FROM _lib_remap r WHERE papersets.library_id = r.dup_id;
    UPDATE "references" SET library_id = r.survivor_id FROM _lib_remap r WHERE "references".library_id = r.dup_id;

    DELETE FROM libraries l USING _lib_remap r WHERE l.id = r.dup_id;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS libraries_user_id_unique
  ON libraries USING btree (user_id);

-- ---------------------------------------------------------------------------
-- Section 7: pre-existing data drift — predeploy gate requires every parse-
-- active paper to have storage_url. A handful of prod rows are marked
-- chandra_status='failed' but never received an upload (storage_url IS NULL),
-- so they were never actually parse-attempted. Reset to 'pending' so the gate
-- can pass; if the user re-uploads, chandra will run from scratch.
-- ---------------------------------------------------------------------------
UPDATE papers
   SET chandra_status = 'pending',
       chandra_completed_at = NULL
 WHERE chandra_status IN ('running', 'done', 'failed')
   AND storage_url IS NULL;

COMMIT;
