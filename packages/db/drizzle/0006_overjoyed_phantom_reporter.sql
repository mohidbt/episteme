ALTER TYPE "public"."provider_type" ADD VALUE 'references';--> statement-breakpoint
ALTER TABLE "document_references" ALTER COLUMN "authors" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "library_references" ALTER COLUMN "authors" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "document_references" ADD COLUMN "influential_citation_count" integer;--> statement-breakpoint
ALTER TABLE "document_references" ADD COLUMN "open_access_pdf_url" text;--> statement-breakpoint
ALTER TABLE "document_references" ADD COLUMN "tldr_text" text;--> statement-breakpoint
ALTER TABLE "document_references" ADD COLUMN "external_ids" jsonb;--> statement-breakpoint
ALTER TABLE "document_references" ADD COLUMN "bibtex" text;--> statement-breakpoint
ALTER TABLE "library_references" ADD COLUMN "influential_citation_count" integer;--> statement-breakpoint
ALTER TABLE "library_references" ADD COLUMN "open_access_pdf_url" text;--> statement-breakpoint
ALTER TABLE "library_references" ADD COLUMN "tldr_text" text;--> statement-breakpoint
ALTER TABLE "library_references" ADD COLUMN "external_ids" jsonb;--> statement-breakpoint
ALTER TABLE "library_references" ADD COLUMN "bibtex" text;