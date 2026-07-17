-- thread_id is caller-supplied and is only unique within a user. Keeping it
-- ahead of user_id in either primary key lets one tenant's identifier collide
-- with another tenant and makes the tenant-scoped ON CONFLICT targets invalid.
ALTER TABLE "agent_message_metadata"
  DROP CONSTRAINT IF EXISTS "agent_message_metadata_pkey",
  ADD CONSTRAINT "agent_message_metadata_pkey"
    PRIMARY KEY ("user_id", "thread_id", "message_id", "kind");
--> statement-breakpoint
ALTER TABLE "agent_thread_papers"
  DROP CONSTRAINT IF EXISTS "agent_thread_papers_pkey",
  ADD CONSTRAINT "agent_thread_papers_pkey"
    PRIMARY KEY ("user_id", "thread_id", "paper_id");
