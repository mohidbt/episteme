-- Read-only role used by the schema-predeploy-prod GitHub Actions check.
--
-- Provisioning is operator-driven (run as neondb_owner). Password generation is
-- the operator's job — substitute '<generated-32-char-password>' below before
-- executing. Do NOT commit the generated password anywhere.
--
-- See ./README.md for when/how to run this and the rotation procedure.

-- Role with no login + login user that inherits from it. The two-tier shape
-- keeps grants on the role and credentials on the user, so we can rotate the
-- password without re-issuing grants.
CREATE ROLE predeploy_ro NOLOGIN;

GRANT CONNECT ON DATABASE neondb TO predeploy_ro;
GRANT USAGE ON SCHEMA public, drizzle TO predeploy_ro;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO predeploy_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO predeploy_ro;

-- Future tables in these schemas automatically grant SELECT to predeploy_ro,
-- so new migrations don't require re-running this script.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO predeploy_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO predeploy_ro;

CREATE USER predeploy_ro_user
  WITH PASSWORD '<generated-32-char-password>'
  IN ROLE predeploy_ro;
