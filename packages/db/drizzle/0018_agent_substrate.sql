-- Step 1: alter model_preference from enum → text (preserving data)
ALTER TABLE "agent_configs" ALTER COLUMN "model_preference" TYPE text USING model_preference::text;
ALTER TABLE "agent_configs" ALTER COLUMN "model_preference" SET DEFAULT 'google/gemma-4-31b-it:free';

-- Step 2: drop the old enum (no column references it anymore)
DROP TYPE "public"."agent_model_preference";

-- Step 3: extend revision_reason enum with 'agent-write'
ALTER TYPE "public"."revision_reason" ADD VALUE 'agent-write';

-- Step 4: create note_revision_author_kind enum
CREATE TYPE "public"."note_revision_author_kind" AS ENUM('user', 'agent');

-- Step 5: add new columns to note_revisions
ALTER TABLE "note_revisions" ADD COLUMN "author_kind" "note_revision_author_kind" DEFAULT 'user' NOT NULL;
ALTER TABLE "note_revisions" ADD COLUMN "agent_invocation_id" uuid;
ALTER TABLE "note_revisions" ADD COLUMN "agent_skill" text;

-- Step 6: create agent_thread_status enum
CREATE TYPE "public"."agent_thread_status" AS ENUM('idle', 'running', 'awaiting_hitl', 'error');

-- Step 7: create agent_threads table
CREATE TABLE "agent_threads" (
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"model_override" text,
	"title" text,
	"skill" text,
	"status" "agent_thread_status" DEFAULT 'idle' NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_threads_user_id_thread_id_pk" PRIMARY KEY("user_id","thread_id")
);

-- Step 8: add FK on agent_threads.user_id
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

-- Step 9: create openrouter_catalog table
CREATE TABLE "openrouter_catalog" (
	"model_id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
