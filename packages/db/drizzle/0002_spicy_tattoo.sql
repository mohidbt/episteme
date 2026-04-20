CREATE TABLE "document_reference_markers" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" integer NOT NULL,
	"page_number" integer NOT NULL,
	"x0" real NOT NULL,
	"y0" real NOT NULL,
	"x1" real NOT NULL,
	"y1" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_reference_markers" ADD CONSTRAINT "document_reference_markers_reference_id_document_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."document_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_reference_markers_reference_id_idx" ON "document_reference_markers" USING btree ("reference_id");