-- GSD-121 — drop FK on user.invite_code.
--
-- 0037 added `user.invite_code text REFERENCES invite_codes(code) ON DELETE SET NULL`.
-- GSD-46 (0056) added the `user_invite_codes` table for per-user referral codes
-- (`episteme-{username}-{n}`). Signup writes the redeemed code into
-- `user.invite_code` regardless of which table it came from, so referral codes
-- violate the FK to `invite_codes`.
--
-- Fix: drop the FK, keep the column as plain text. The column still records
-- which code the user redeemed (admin allowlist OR per-user referral); the
-- stamp on the source table (`invite_codes.used_by_user_id` or
-- `user_invite_codes.consumed_by_user_id`) is the authoritative link.
--
-- ALTER on legacy `user` table → requires owner-real role to apply
-- (migrate_only ownership wall — see feedback_db_migrations memory).
-- Idempotent via IF EXISTS; safe to re-apply.

ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_invite_code_fkey";
