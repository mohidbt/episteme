-- Repair: prod's paper_highlights.run_id was created as integer at some
-- point pre-0027 (likely manual). 0027's ADD COLUMN was no-op'd because
-- the column already existed, leaving the type wrong. Agent writes uuid
-- strings → 22P02 invalid_text_representation. Tool_call_id alongside as
-- a precaution. ALTER ... USING is idempotent on text columns.
--
-- Each ALTER takes ACCESS EXCLUSIVE on paper_highlights. lock_timeout
-- bounds blast radius if the table is busy at apply time. Re-run after
-- failure is safe.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "paper_highlights"
  ALTER COLUMN "run_id" SET DATA TYPE text USING "run_id"::text;--> statement-breakpoint
ALTER TABLE "paper_highlights"
  ALTER COLUMN "tool_call_id" SET DATA TYPE text USING "tool_call_id"::text;
