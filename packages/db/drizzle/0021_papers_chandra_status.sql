ALTER TABLE "papers" ADD COLUMN "chandra_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "chandra_completed_at" timestamp with time zone;
