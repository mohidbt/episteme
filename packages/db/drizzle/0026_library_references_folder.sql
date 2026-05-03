ALTER TABLE "library_references" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "library_references" ADD CONSTRAINT "library_references_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_references_folder_idx" ON "library_references" USING btree ("user_id", "folder_id");
