-- GSD-142: grandfather existing real (non-anonymous) accounts before the
-- email-verification hard-block ships. Every such user predates the gate and
-- must not be locked out. This one-shot UPDATE only touches rows that exist
-- when it runs; NEW signups (inserted afterward) keep email_verified=false and
-- correctly hit the gate. Anonymous users are exempt at the gate layer, so
-- their email_verified stays informational and is left untouched here.
--
-- MUST be applied BEFORE the gate deploy, or existing unverified users lock out.
UPDATE "user"
SET "email_verified" = true
WHERE "email_verified" = false
  AND "is_anonymous" = false;
