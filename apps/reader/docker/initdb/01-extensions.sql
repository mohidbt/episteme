-- Runs once on first container boot as the postgres superuser via
-- /docker-entrypoint-initdb.d. Not part of drizzle migrations because
-- CREATE EXTENSION requires superuser.
CREATE EXTENSION IF NOT EXISTS vector;
