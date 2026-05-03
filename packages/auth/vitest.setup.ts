import { config } from "dotenv";

// WHY: @episteme/db reads DATABASE_URL at module-import time (postgres-js client
// is created at top level). Tests in this package transitively import db via
// `../server`, so env must be loaded before any test module evaluates. Vitest
// runs setupFiles before test-file imports, making this the correct seam.
// We reach into apps/km/.env to match the pattern used by
// packages/db/drizzle.config.ts — there is no per-package .env in this monorepo.
const result = config({ path: "../../apps/km/.env" });

if (result.error && !process.env.DATABASE_URL) {
  throw new Error(
    `Failed to load apps/km/.env and DATABASE_URL is not set: ${result.error.message}`,
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL not set after loading apps/km/.env",
  );
}
