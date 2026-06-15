-- GSD-119: university free-text field on signup persona profile + waitlist.
-- Optional; we don't gate signup on filling it in.
ALTER TABLE "user_signup_profiles" ADD COLUMN IF NOT EXISTS "university" text;
--> statement-breakpoint
ALTER TABLE "signup_waitlist" ADD COLUMN IF NOT EXISTS "university" text;
