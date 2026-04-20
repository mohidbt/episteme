CREATE TABLE "document_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"marker_text" text NOT NULL,
	"marker_index" integer NOT NULL,
	"raw_text" text,
	"title" text,
	"authors" text,
	"year" text,
	"doi" text,
	"url" text,
	"semantic_scholar_id" text,
	"abstract" text,
	"venue" text,
	"citation_count" integer,
	"page_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"authors" text,
	"year" text,
	"doi" text,
	"url" text,
	"semantic_scholar_id" text,
	"abstract" text,
	"venue" text,
	"citation_count" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kept_citations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document_reference_id" integer NOT NULL,
	"library_reference_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kept_citations_user_doc_ref_unique" UNIQUE("user_id","document_reference_id")
);
--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_references" ADD CONSTRAINT "library_references_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_citations" ADD CONSTRAINT "kept_citations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_citations" ADD CONSTRAINT "kept_citations_document_reference_id_document_references_id_fk" FOREIGN KEY ("document_reference_id") REFERENCES "public"."document_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_citations" ADD CONSTRAINT "kept_citations_library_reference_id_library_references_id_fk" FOREIGN KEY ("library_reference_id") REFERENCES "public"."library_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_references_document_id_idx" ON "document_references" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "library_references_user_id_idx" ON "library_references" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_references_user_doi_unique_idx" ON "library_references" USING btree ("user_id","doi") WHERE "library_references"."doi" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kept_citations_user_id_idx" ON "kept_citations" USING btree ("user_id");