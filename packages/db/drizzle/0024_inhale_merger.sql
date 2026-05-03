-- Phase 1.5.2 inhale-merger: drop documents + ai_highlight_runs,
-- re-key 8 sub-tables to papers.id (uuid).
--
-- Pre-flight probe MUST be green before running this migration:
--   pnpm -F @episteme/db tsx scripts/probe-inhale-merger.ts
--
-- Tables re-keyed: document_sections, document_chunks, document_references,
-- document_outlines, document_segments, processing_jobs, user_highlights,
-- agent_conversations.
-- Tables dropped: documents, ai_highlight_runs.

-- ---------------------------------------------------------------------------
-- Re-confirm probe inline: zero orphans, zero ambiguous documents↔papers joins.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  orphans_count int;
  ambiguous_count int;
BEGIN
  SELECT COUNT(*) INTO orphans_count
    FROM documents d
    LEFT JOIN papers p
      ON p.user_id = d.user_id AND p.filename = d.filename
    WHERE p.id IS NULL;
  SELECT COUNT(*) INTO ambiguous_count
    FROM (
      SELECT d.id
        FROM documents d
        JOIN papers p
          ON p.user_id = d.user_id AND p.filename = d.filename
       GROUP BY d.id
       HAVING COUNT(p.id) > 1
    ) sub;
  IF orphans_count > 0 OR ambiguous_count > 0 THEN
    RAISE EXCEPTION 'inhale-merger probe failed: % orphans, % ambiguous', orphans_count, ambiguous_count;
  END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. document_sections: int document_id -> uuid paper_id
-- ---------------------------------------------------------------------------
ALTER TABLE "document_sections" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "document_sections" ds
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE ds."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "document_sections" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sections" DROP CONSTRAINT IF EXISTS "document_sections_document_id_documents_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "document_sections_document_idx";--> statement-breakpoint
ALTER TABLE "document_sections" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_sections_paper_idx" ON "document_sections" USING btree ("paper_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. document_chunks: int document_id -> uuid paper_id
-- ---------------------------------------------------------------------------
ALTER TABLE "document_chunks" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "document_chunks" dc
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE dc."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "document_chunks" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_document_id_documents_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "document_chunks_document_idx";--> statement-breakpoint
ALTER TABLE "document_chunks" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunks_paper_idx" ON "document_chunks" USING btree ("paper_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. document_references: int document_id -> uuid paper_id
-- ---------------------------------------------------------------------------
ALTER TABLE "document_references" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "document_references" dr
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE dr."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "document_references" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_references" DROP CONSTRAINT IF EXISTS "document_references_document_id_documents_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "document_references_document_id_idx";--> statement-breakpoint
ALTER TABLE "document_references" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_references_paper_id_idx" ON "document_references" USING btree ("paper_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. document_outlines: int document_id (UNIQUE) -> uuid paper_id (UNIQUE)
-- ---------------------------------------------------------------------------
ALTER TABLE "document_outlines" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "document_outlines" do_
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE do_."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "document_outlines" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_outlines" DROP CONSTRAINT IF EXISTS "document_outlines_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_outlines" DROP CONSTRAINT IF EXISTS "document_outlines_document_id_unique";--> statement-breakpoint
ALTER TABLE "document_outlines" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "document_outlines" ADD CONSTRAINT "document_outlines_paper_id_unique" UNIQUE ("paper_id");--> statement-breakpoint
ALTER TABLE "document_outlines" ADD CONSTRAINT "document_outlines_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. document_segments: text document_id (post-0022, no FK) -> uuid paper_id
-- The text column may hold either old documents.id (as string) or papers.id (uuid).
-- Try direct uuid cast first; fall back to documents↔papers join.
-- ---------------------------------------------------------------------------
ALTER TABLE "document_segments" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
-- Direct uuid cast where text already encodes a paper uuid
UPDATE "document_segments"
   SET "paper_id" = "document_id"::uuid
 WHERE "document_id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';--> statement-breakpoint
-- Numeric document_id strings: backfill via documents↔papers
UPDATE "document_segments" ds
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE ds."paper_id" IS NULL
   AND ds."document_id" ~ '^[0-9]+$'
   AND d.id = ds."document_id"::int;--> statement-breakpoint
ALTER TABLE "document_segments" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "document_segments_document_page_idx";--> statement-breakpoint
ALTER TABLE "document_segments" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "document_segments" ADD CONSTRAINT "document_segments_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_segments_paper_page_idx" ON "document_segments" USING btree ("paper_id","page");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. processing_jobs: int document_id -> uuid paper_id
-- ---------------------------------------------------------------------------
ALTER TABLE "processing_jobs" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "processing_jobs" pj
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE pj."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "processing_jobs" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "processing_jobs" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. user_highlights: int document_id -> uuid paper_id
-- ---------------------------------------------------------------------------
ALTER TABLE "user_highlights" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "user_highlights" uh
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE uh."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "user_highlights" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_highlights" DROP CONSTRAINT IF EXISTS "user_highlights_document_id_documents_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "user_highlights_user_document_idx";--> statement-breakpoint
ALTER TABLE "user_highlights" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "user_highlights" ADD CONSTRAINT "user_highlights_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_highlights_user_paper_idx" ON "user_highlights" USING btree ("user_id","paper_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. agent_conversations: int document_id -> uuid paper_id (table KEPT)
-- ---------------------------------------------------------------------------
ALTER TABLE "agent_conversations" ADD COLUMN "paper_id" uuid;--> statement-breakpoint
UPDATE "agent_conversations" ac
   SET "paper_id" = p.id
  FROM "documents" d
  JOIN "papers" p ON p.user_id = d.user_id AND p.filename = d.filename
 WHERE ac."document_id" = d.id;--> statement-breakpoint
ALTER TABLE "agent_conversations" ALTER COLUMN "paper_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_conversations" DROP CONSTRAINT IF EXISTS "agent_conversations_document_id_documents_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "agent_conversations_kind_idx";--> statement-breakpoint
ALTER TABLE "agent_conversations" DROP COLUMN "document_id";--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conversations_kind_idx" ON "agent_conversations" USING btree ("paper_id","kind");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 9. Drop ai_highlight_runs (depends on documents)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "ai_highlight_runs";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 10. Drop documents (now unreferenced)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "documents";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 11. Drop processing_status enum (was only used by documents)
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS "processing_status";
