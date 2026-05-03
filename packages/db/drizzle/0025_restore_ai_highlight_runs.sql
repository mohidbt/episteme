CREATE TABLE "ai_highlight_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"instruction" text NOT NULL,
	"model_used" text,
	"status" text NOT NULL,
	"summary" text,
	"conversation_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_highlight_runs" ADD CONSTRAINT "ai_highlight_runs_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_highlight_runs" ADD CONSTRAINT "ai_highlight_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_highlight_runs" ADD CONSTRAINT "ai_highlight_runs_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_highlight_runs_paper_idx" ON "ai_highlight_runs" USING btree ("paper_id","created_at" DESC);
