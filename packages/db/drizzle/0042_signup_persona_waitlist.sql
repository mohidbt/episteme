-- Signup funnel persona detail + invite waitlist.
--
-- These are new public tables owned by migrate_only. Grants are covered by
-- the default privileges fixed in 0038; do not ALTER legacy "user" for these
-- persona detail fields.

CREATE TABLE IF NOT EXISTS "user_signup_profiles" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "student_level" text CHECK ("student_level" IS NULL OR "student_level" IN ('Bachelor','Master','PhD')),
  "job_role" text,
  "industry" text,
  "persona_other" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "signup_waitlist" (
  "email" text PRIMARY KEY,
  "firstname" text NOT NULL,
  "username" text NOT NULL,
  "user_type" text NOT NULL CHECK ("user_type" IN ('student','researcher','industry','other')),
  "pokemon" text NOT NULL CHECK ("pokemon" IN ('charmander','squirtle','bulbasaur')),
  "student_level" text CHECK ("student_level" IS NULL OR "student_level" IN ('Bachelor','Master','PhD')),
  "job_role" text,
  "industry" text,
  "persona_other" text,
  "attempted_invite_code" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
