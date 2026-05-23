CREATE TABLE "agent_message_metadata" (
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_message_metadata_pkey" PRIMARY KEY ("thread_id", "message_id", "kind")
);--> statement-breakpoint
ALTER TABLE "agent_message_metadata" ADD CONSTRAINT "agent_message_metadata_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_message_metadata_user_id_idx" ON "agent_message_metadata" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_message_metadata_thread_id_idx" ON "agent_message_metadata" USING btree ("thread_id");
