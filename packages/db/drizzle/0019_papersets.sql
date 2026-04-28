CREATE TABLE "papersets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"folder_id" uuid,
	"prev_folder_id" uuid,
	"filename" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cell_grounding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"running_cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "papersets" ADD CONSTRAINT "papersets_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papersets" ADD CONSTRAINT "papersets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papersets" ADD CONSTRAINT "papersets_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papersets" ADD CONSTRAINT "papersets_prev_folder_id_folders_id_fk" FOREIGN KEY ("prev_folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;