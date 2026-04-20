CREATE TABLE "document_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"page" integer NOT NULL,
	"kind" text NOT NULL,
	"bbox" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_segments" ADD CONSTRAINT "document_segments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_segments_document_page_idx" ON "document_segments" USING btree ("document_id","page");