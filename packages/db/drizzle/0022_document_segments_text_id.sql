ALTER TABLE "document_segments" DROP CONSTRAINT "document_segments_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_segments" ALTER COLUMN "document_id" SET DATA TYPE text USING "document_id"::text;
