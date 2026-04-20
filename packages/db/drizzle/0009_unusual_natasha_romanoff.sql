CREATE TYPE "public"."note_type" AS ENUM('md', 'latex', 'pdf-ref');--> statement-breakpoint
CREATE TYPE "public"."note_link_target_kind" AS ENUM('note', 'paper', 'reference');--> statement-breakpoint
CREATE TYPE "public"."revision_reason" AS ENUM('autosave', 'manual', 'pre-ai-edit', 'conflict-resolve');--> statement-breakpoint
CREATE TYPE "public"."agent_model_preference" AS ENUM('haiku', 'sonnet', 'opus');--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"filename" text NOT NULL,
	"storage_url" text,
	"title" text,
	"authors" text[],
	"year" integer,
	"doi" text,
	"venue" text,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"page" integer NOT NULL,
	"bbox" jsonb,
	"color" text,
	"note_md" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"chunk_idx" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"citation_key" text NOT NULL,
	"csl_json" jsonb,
	"paper_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"filename" text,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"content_json" jsonb,
	"yjs_state" "bytea",
	"note_type" "note_type" DEFAULT 'md' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_slug" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_note_id" uuid NOT NULL,
	"target_kind" "note_link_target_kind" NOT NULL,
	"target_id" uuid,
	"target_title_raw" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"content_md" text NOT NULL,
	"reason" "revision_reason" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"chunk_idx" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled_skills" text[] DEFAULT '{}' NOT NULL,
	"attached_mcps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_preference" "agent_model_preference" DEFAULT 'sonnet' NOT NULL,
	"approval_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skills_md" text DEFAULT '' NOT NULL,
	"memory_md" text DEFAULT '' NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"namespace" text[] NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_highlights" ADD CONSTRAINT "paper_highlights_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_highlights" ADD CONSTRAINT "paper_highlights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_embeddings" ADD CONSTRAINT "paper_embeddings_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_embeddings" ADD CONSTRAINT "note_embeddings_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "papers_library_idx" ON "papers" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "papers_folder_path_idx" ON "papers" USING btree ("library_id","folder_path");--> statement-breakpoint
CREATE INDEX "paper_embeddings_paper_idx" ON "paper_embeddings" USING btree ("paper_id");--> statement-breakpoint
CREATE UNIQUE INDEX "references_library_key_unique" ON "references" USING btree ("library_id","citation_key");--> statement-breakpoint
CREATE INDEX "references_library_folder_idx" ON "references" USING btree ("library_id","folder_path");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_slug_unique" ON "notes" USING btree ("user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_public_slug_unique" ON "notes" USING btree ("user_id","public_slug");--> statement-breakpoint
CREATE INDEX "notes_library_folder_idx" ON "notes" USING btree ("library_id","folder_path");--> statement-breakpoint
CREATE INDEX "note_links_source_idx" ON "note_links" USING btree ("source_note_id");--> statement-breakpoint
CREATE INDEX "note_links_target_idx" ON "note_links" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "note_embeddings_note_idx" ON "note_embeddings" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "agent_memories_user_ns_idx" ON "agent_memories" USING btree ("user_id","namespace");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_embeddings_ivfflat_idx"
  ON "note_embeddings" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_embeddings_ivfflat_idx"
  ON "paper_embeddings" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);