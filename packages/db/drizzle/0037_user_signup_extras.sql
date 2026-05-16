-- D4: signup extras on legacy `user` table.
--
-- New profile/onboarding fields captured at real-user signup:
--   firstname    — user's given name (separate from existing `name` column;
--                  used by deriveLibraryName() preference order).
--   user_type    — coarse persona for product analytics / future routing.
--   pokemon      — vanity avatar pick (8-bit picker on signup screen).
--   invite_code  — soft FK to invite_codes(code); ON DELETE SET NULL so a
--                  hypothetical invite-row prune doesn't cascade-orphan users.
--
-- ALTER on legacy `user` table → requires owner-real role to apply
-- (migrate_only ownership wall — see feedback_db_migrations memory).

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "firstname" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "user_type" text CHECK ("user_type" IS NULL OR "user_type" IN ('student','researcher','industry','other'));--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pokemon" text CHECK ("pokemon" IS NULL OR "pokemon" IN ('charmander','squirtle','bulbasaur'));--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "invite_code" text REFERENCES "invite_codes"("code") ON DELETE SET NULL;
