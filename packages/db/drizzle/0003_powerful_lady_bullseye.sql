CREATE TYPE "public"."highlight_source" AS ENUM('user', 'ai-auto');--> statement-breakpoint
ALTER TYPE "public"."highlight_color" ADD VALUE 'amber';--> statement-breakpoint
ALTER TABLE "user_highlights" ADD COLUMN "source" "highlight_source" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_highlights" ADD COLUMN "layer_id" uuid;--> statement-breakpoint
ALTER TABLE "user_highlights" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "user_highlights" ADD COLUMN "rects" jsonb;--> statement-breakpoint
CREATE INDEX "user_highlights_layer_idx" ON "user_highlights" USING btree ("layer_id");