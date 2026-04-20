ALTER TABLE "note_revisions" DROP CONSTRAINT "note_revisions_author_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "notes_user_public_slug_unique";--> statement-breakpoint
ALTER TABLE "note_revisions" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_highlights_paper_idx" ON "paper_highlights" USING btree ("paper_id");--> statement-breakpoint
CREATE INDEX "paper_embeddings_embedding_idx" ON "paper_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists=100);--> statement-breakpoint
CREATE INDEX "note_embeddings_embedding_idx" ON "note_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists=100);--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_public_slug_unique" ON "notes" USING btree ("user_id","public_slug") WHERE public_slug IS NOT NULL;