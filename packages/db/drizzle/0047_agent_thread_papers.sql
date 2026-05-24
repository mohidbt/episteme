CREATE TABLE IF NOT EXISTS "agent_thread_papers" (
	"thread_id" text NOT NULL,
	"paper_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_thread_papers_pkey" PRIMARY KEY ("thread_id", "paper_id")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_thread_papers" ADD CONSTRAINT "agent_thread_papers_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_thread_papers" ADD CONSTRAINT "agent_thread_papers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_thread_papers_user_paper_idx" ON "agent_thread_papers" USING btree ("user_id","paper_id","created_at" DESC);
