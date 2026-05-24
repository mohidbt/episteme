CREATE TYPE "public"."citation_enrichment_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "citation_enrichment_jobs" (
	"paper_id" uuid PRIMARY KEY NOT NULL,
	"status" "citation_enrichment_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"total_refs" integer DEFAULT 0 NOT NULL,
	"enriched_refs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citation_enrichment_jobs" ADD CONSTRAINT "citation_enrichment_jobs_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "citation_enrichment_jobs_paper_id_unique" ON "citation_enrichment_jobs" USING btree ("paper_id");--> statement-breakpoint
ALTER TABLE "citation_enrichment_jobs" ADD CONSTRAINT "citation_enrichment_jobs_attempts_nonnegative" CHECK ("attempts" >= 0);--> statement-breakpoint
ALTER TABLE "citation_enrichment_jobs" ADD CONSTRAINT "citation_enrichment_jobs_totals_nonnegative" CHECK ("total_refs" >= 0 AND "enriched_refs" >= 0);
